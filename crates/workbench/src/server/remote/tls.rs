use super::{DomainError, ErrorKind, remote_error};
use serde_json::{Value, json};
use std::{net::IpAddr, path::Path as FsPath};

pub(super) fn tls_invalid() -> DomainError {
    remote_error(
        ErrorKind::RemoteTlsInvalid,
        "本地远程证书记录无效，请在电脑检查配置",
    )
}
pub(super) fn load_certificate(directory: &FsPath, ip: IpAddr) -> Result<Value, DomainError> {
    use std::io::Read;
    let path = directory.join("remote-tls.json");
    let metadata = match std::fs::metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            // Existing public trust material is evidence of an established identity.
            match std::fs::symlink_metadata(directory.join("VibeOne-Root-CA.crt")) {
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    return certificate(ip);
                }
                _ => return Err(tls_invalid()),
            }
        }
        Err(_) => {
            return Err(remote_error(
                ErrorKind::RemoteTlsUnavailable,
                "无法读取远程证书记录",
            ));
        }
    };
    if !metadata.is_file() || metadata.len() > 128 * 1024 {
        return Err(tls_invalid());
    }
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(rustix::fs::OFlags::NONBLOCK.bits() as i32);
    }
    let file = options
        .open(path)
        .map_err(|_| remote_error(ErrorKind::RemoteTlsUnavailable, "无法读取远程证书记录"))?;
    if !file.metadata().map_err(|_| tls_invalid())?.is_file() {
        return Err(tls_invalid());
    }
    let mut bytes = vec![];
    file.take(128 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| tls_invalid())?;
    if bytes.len() > 128 * 1024 {
        return Err(tls_invalid());
    }
    let saved: Value = serde_json::from_slice(&bytes).map_err(|_| tls_invalid())?;
    if !["ip", "ca", "chain", "key"].iter().all(|key| {
        saved[*key]
            .as_str()
            .is_some_and(|value| !value.trim().is_empty())
    }) {
        return Err(tls_invalid());
    }
    let saved_ip: IpAddr = saved["ip"]
        .as_str()
        .ok_or_else(tls_invalid)?
        .parse()
        .map_err(|_| tls_invalid())?;
    if !saved["chain"]
        .as_str()
        .ok_or_else(tls_invalid)?
        .ends_with(saved["ca"].as_str().ok_or_else(tls_invalid)?)
    {
        return Err(tls_invalid());
    }
    if saved_ip == ip {
        Ok(saved)
    } else {
        certificate(ip)
    }
}
pub(super) fn write_private(path: &FsPath, bytes: &[u8]) -> Result<(), DomainError> {
    use std::io::Write;
    let temporary = path.with_file_name(format!(".remote-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let failed = |_| {
            remote_error(
                ErrorKind::RemoteTlsUnavailable,
                "无法保存远程证书，请检查目录及权限",
            )
        };
        let mut file = options.open(&temporary).map_err(failed)?;
        file.write_all(bytes).map_err(failed)?;
        file.sync_all().map_err(failed)?;
        drop(file);
        std::fs::rename(&temporary, path).map_err(failed)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temporary);
    }
    result
}
fn certificate(ip: IpAddr) -> Result<Value, DomainError> {
    use rcgen::{
        BasicConstraints, CertificateParams, DnType, ExtendedKeyUsagePurpose, IsCa, Issuer,
        KeyPair, KeyUsagePurpose,
    };
    let mut ca = CertificateParams::new(Vec::<String>::new()).map_err(|_| {
        remote_error(
            ErrorKind::RemoteTlsUnavailable,
            "无法生成或保存远程证书，请检查目录及权限",
        )
    })?;
    ca.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
    ca.distinguished_name
        .push(DnType::CommonName, "VibeOne Local Root");
    ca.key_usages = vec![
        KeyUsagePurpose::KeyCertSign,
        KeyUsagePurpose::CrlSign,
        KeyUsagePurpose::DigitalSignature,
    ];
    ca.not_before = time::OffsetDateTime::now_utc() - time::Duration::days(1);
    ca.not_after = time::OffsetDateTime::now_utc() + time::Duration::days(3650);
    let key = KeyPair::generate().map_err(|_| {
        remote_error(
            ErrorKind::RemoteTlsUnavailable,
            "无法生成或保存远程证书，请检查目录及权限",
        )
    })?;
    let root = ca.self_signed(&key).map_err(|_| {
        remote_error(
            ErrorKind::RemoteTlsUnavailable,
            "无法生成或保存远程证书，请检查目录及权限",
        )
    })?;
    let issuer = Issuer::new(ca, key);
    let mut leaf = CertificateParams::new(vec![ip.to_string()]).map_err(|_| {
        remote_error(
            ErrorKind::RemoteTlsUnavailable,
            "无法生成或保存远程证书，请检查目录及权限",
        )
    })?;
    leaf.distinguished_name
        .push(DnType::CommonName, "VibeOne Host");
    leaf.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];
    leaf.key_usages = vec![KeyUsagePurpose::DigitalSignature];
    leaf.not_before = time::OffsetDateTime::now_utc() - time::Duration::days(1);
    leaf.not_after = time::OffsetDateTime::now_utc() + time::Duration::days(730);
    let key = KeyPair::generate().map_err(|_| {
        remote_error(
            ErrorKind::RemoteTlsUnavailable,
            "无法生成或保存远程证书，请检查目录及权限",
        )
    })?;
    let cert = leaf.signed_by(&key, &issuer).map_err(|_| {
        remote_error(
            ErrorKind::RemoteTlsUnavailable,
            "无法生成或保存远程证书，请检查目录及权限",
        )
    })?;
    Ok(
        json!({"ip":ip.to_string(),"ca":root.pem(),"chain":format!("{}{}",cert.pem(),root.pem()),"key":key.serialize_pem()}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn missing_private_record_never_silently_replaces_an_existing_root() {
        let directory = tempfile::tempdir().unwrap();
        let ca = directory.path().join("VibeOne-Root-CA.crt");
        std::fs::write(&ca, "existing trust identity").unwrap();
        let Err(error) = load_certificate(directory.path(), "127.0.0.1".parse().unwrap()) else {
            panic!("missing private record must be explicit");
        };
        assert_eq!(error.kind, ErrorKind::RemoteTlsInvalid);
        assert_eq!(
            std::fs::read_to_string(ca).unwrap(),
            "existing trust identity"
        );
        assert!(!directory.path().join("remote-tls.json").exists());
    }
    #[test]
    fn mismatched_root_and_chain_are_rejected_without_rewriting_the_cache() {
        let directory = tempfile::tempdir().unwrap();
        let ip = "127.0.0.1".parse().unwrap();
        let mut value = certificate(ip).unwrap();
        value["ca"] = json!("PRIVATE_WRONG_ROOT");
        let bytes = serde_json::to_vec(&value).unwrap();
        let path = directory.path().join("remote-tls.json");
        std::fs::write(&path, &bytes).unwrap();
        let Err(error) = load_certificate(directory.path(), ip) else {
            panic!("bad root must be rejected");
        };
        assert_eq!(error.kind, ErrorKind::RemoteTlsInvalid);
        assert!(!error.message.contains("PRIVATE"));
        assert_eq!(std::fs::read(path).unwrap(), bytes);
    }
}
