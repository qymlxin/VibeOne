//! Local management commands reuse the running Host; they never open its database.
use http_body_util::{BodyExt, Full, Limited};
use hyper::{Request, body::Bytes, client::conn::http1};
use hyper_util::rt::TokioIo;
use serde_json::{Value, json};
use std::{ffi::OsString, net::SocketAddr, path::PathBuf, time::Duration};
use tokio::io::AsyncReadExt;
use vibeone_workbench::contracts::{
    CreateSessionRequest, ProfileCatalogResponse, ProviderProbeRequest,
};

pub const USAGE: &str = "  vibeone-host profiles list [--data-dir <directory>]\n  vibeone-host profiles probe --profile <id> [--data-dir <directory>]\n  vibeone-host session create --profile <id> [--workspace <directory>] [--data-dir <directory>]\n\nThese commands connect to the running local Host; create does not send a task.";
struct Options {
    data: PathBuf,
    profile: Option<String>,
    workspace: String,
}
fn options(
    args: &[OsString],
    allow_profile: bool,
    allow_workspace: bool,
) -> Result<Options, String> {
    let mut data = None;
    let mut profile = None;
    let mut workspace = None;
    let mut index = 2;
    while index < args.len() {
        let flag = args[index].to_str().ok_or("参数名称无效")?;
        let value = args.get(index + 1).ok_or("参数缺少值，请查看 --help")?;
        if value.to_str().is_some_and(|value| value.starts_with("--")) {
            return Err("参数缺少值，请查看 --help".into());
        }
        match flag {
            "--data-dir" if data.is_none() => data = Some(PathBuf::from(value)),
            "--profile" if allow_profile && profile.is_none() => {
                profile = Some(
                    value
                        .to_str()
                        .filter(|value| !value.trim().is_empty())
                        .ok_or("配置身份无效")?
                        .to_owned(),
                )
            }
            "--workspace" if allow_workspace && workspace.is_none() => {
                let path = PathBuf::from(value)
                    .canonicalize()
                    .map_err(|_| "工作目录不存在或不可访问")?;
                if !path.is_dir() {
                    return Err("工作目录不是文件夹".into());
                }
                workspace = Some(path.to_str().ok_or("工作目录名称无效")?.to_owned());
            }
            _ => return Err("不支持或重复的参数，请查看 --help".into()),
        }
        index += 2;
    }
    let data = data
        .or_else(|| std::env::var_os("VIBEONE_DATA_DIR").map(PathBuf::from))
        .or_else(|| {
            std::env::var_os("HOME")
                .or_else(|| std::env::var_os("USERPROFILE"))
                .map(|home| PathBuf::from(home).join(".vibeone"))
        })
        .ok_or("无法确定Host数据目录，请指定 --data-dir")?;
    if allow_profile && profile.is_none() {
        return Err("需要 --profile <id>；先使用 profiles list 查看配置".into());
    }
    Ok(Options {
        data,
        profile,
        workspace: workspace.unwrap_or_default(),
    })
}
struct LocalHost {
    address: SocketAddr,
    token: String,
}
impl LocalHost {
    async fn read(data: PathBuf) -> Result<Self, String> {
        let file = tokio::fs::File::open(data.join("host.json"))
            .await
            .map_err(|_| "未找到运行中的Host，请先启动桌面应用或 serve")?;
        let mut bytes = Vec::new();
        file.take(65537)
            .read_to_end(&mut bytes)
            .await
            .map_err(|_| "无法读取Host连接信息")?;
        if bytes.len() > 65536 {
            return Err("Host连接信息超过大小限制".into());
        }
        let value: Value = serde_json::from_slice(&bytes).map_err(|_| "Host连接信息无效")?;
        let address = value["url"]
            .as_str()
            .and_then(|url| url.strip_prefix("http://"))
            .and_then(|value| value.parse::<SocketAddr>().ok())
            .filter(|address| address.ip().is_loopback() && address.port() != 0)
            .ok_or("CLI只允许连接本机回环HTTP地址，请检查Host连接信息")?;
        let token = value["token"]
            .as_str()
            .filter(|token| {
                !token.is_empty()
                    && token.len() <= 512
                    && token.bytes().all(|c| c.is_ascii_graphic())
            })
            .ok_or("Host凭据格式无效")?
            .to_owned();
        Ok(Self { address, token })
    }
    async fn request(&self, path: &str, body: Option<Value>) -> Result<Value, String> {
        tokio::time::timeout(Duration::from_secs(25), self.request_inner(path, body))
            .await
            .map_err(|_| "主机请求超时，请检查桌面状态；命令未自动重试".to_owned())?
    }
    async fn request_inner(&self, path: &str, body: Option<Value>) -> Result<Value, String> {
        let stream = tokio::net::TcpStream::connect(self.address)
            .await
            .map_err(|_| "无法连接Host，请确认它仍在运行")?;
        let (mut sender, connection) = http1::handshake(TokioIo::new(stream))
            .await
            .map_err(|_| "无法建立Host连接")?;
        let _driver = Driver(tokio::spawn(async move {
            let _ = connection.await;
        }));
        let bytes = body
            .as_ref()
            .map(serde_json::to_vec)
            .transpose()
            .map_err(|_| "无法编码请求")?
            .unwrap_or_default();
        let request = Request::builder()
            .method(if body.is_some() { "POST" } else { "GET" })
            .uri(path)
            .header("host", self.address.to_string())
            .header("authorization", format!("Bearer {}", self.token))
            .header("content-type", "application/json")
            .body(Full::new(Bytes::from(bytes)))
            .map_err(|_| "无法构造Host请求")?;
        let response = sender
            .send_request(request)
            .await
            .map_err(|_| "Host响应中断；请在桌面核对操作结果，命令未自动重试")?;
        if !response.status().is_success() {
            let status = response.status().as_u16();
            let reason = match status {
                401 => "Host凭据已失效，请重新连接运行中的Host",
                404 | 405 => "接口或配置不存在，请刷新列表；旧Host需要先升级",
                _ => "Host拒绝请求，请在桌面查看配置、权限或运行状态",
            };
            return Err(format!("{reason}（HTTP {status}）"));
        }
        let bytes = Limited::new(response.into_body(), 1024 * 1024)
            .collect()
            .await
            .map_err(|_| "Host响应中断或超过1 MiB限制，请在桌面核对结果")?
            .to_bytes();
        serde_json::from_slice(&bytes).map_err(|_| "Host响应不是有效JSON".into())
    }
    async fn catalog(&self) -> Result<ProfileCatalogResponse, String> {
        serde_json::from_value(self.request("/v1/profiles", None).await?)
            .map_err(|_| "Host配置目录格式不兼容，请更新Host".to_owned())
    }
}
struct Driver(tokio::task::JoinHandle<()>);
impl Drop for Driver {
    fn drop(&mut self) {
        self.0.abort();
    }
}
fn segment(value: &str) -> String {
    let mut result = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_') {
            result.push(byte as char);
        } else {
            result.push_str(&format!("%{byte:02X}"));
        }
    }
    result
}
pub async fn run(args: &[OsString]) -> Result<(), String> {
    if args.iter().any(|arg| arg == "--help") {
        println!("{USAGE}");
        return Ok(());
    }
    let action = match (
        args.first().and_then(|s| s.to_str()),
        args.get(1).and_then(|s| s.to_str()),
    ) {
        (Some("profiles"), Some("list")) => "list",
        (Some("profiles"), Some("probe")) => "probe",
        (Some("session"), Some("create")) => "create",
        _ => return Err(format!("未知命令。\n{USAGE}")),
    };
    let options = options(args, action != "list", action == "create")?;
    let host = LocalHost::read(options.data).await?;
    let catalog = host.catalog().await?;
    let value = if action == "list" {
        // No startup arguments, custom extensions, record hashes or conversation data.
        json!({"profiles":catalog.profiles,"issues":catalog.issues.iter().map(|issue|json!({"id":issue.id,"error":issue.error})).collect::<Vec<_>>()})
    } else {
        let id = options.profile.as_deref().expect("required profile");
        let profile = catalog
            .profiles
            .iter()
            .find(|profile| profile.id == id)
            .ok_or("配置不存在或不可用，请用 profiles list 刷新")?;
        if action == "probe" {
            let body = serde_json::to_value(ProviderProbeRequest {
                profile_id: Some(id.into()),
            })
            .map_err(|_| "无法编码探测请求")?;
            host.request(
                &format!("/v1/providers/{}/probe", segment(&profile.provider)),
                Some(body),
            )
            .await?
        } else {
            let body = serde_json::to_value(CreateSessionRequest {
                provider: profile.provider.clone(),
                workspace: options.workspace,
                profile_id: Some(id.into()),
            })
            .map_err(|_| "无法编码会话请求")?;
            host.request("/v1/sessions", Some(body)).await?
        }
    };
    println!(
        "{}",
        serde_json::to_string_pretty(&value).map_err(|_| "无法编码命令结果")?
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    #[tokio::test]
    async fn stalled_reply_times_out_and_drops_its_owned_connection() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            let mut bytes = [0; 4096];
            while !request.windows(4).any(|part| part == b"\r\n\r\n") {
                let count = stream.read(&mut bytes).await.unwrap();
                assert!(count > 0 && request.len() + count <= 65536);
                request.extend_from_slice(&bytes[..count]);
            }
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n")
                .await
                .unwrap();
            let _ = ready_tx.send(());
            let mut closed = [0; 1];
            match stream.read(&mut closed).await {
                Ok(0) => (),
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::ConnectionReset | std::io::ErrorKind::ConnectionAborted
                    ) => {}
                result => panic!("deadline must close the socket; observed {result:?}"),
            }
        });
        let request = tokio::spawn(async move {
            LocalHost {
                address,
                token: "private-fixture".into(),
            }
            .request("/v1/profiles", None)
            .await
        });
        ready_rx.await.unwrap();
        tokio::time::pause();
        tokio::time::advance(Duration::from_secs(26)).await;
        let failure = request.await.unwrap().unwrap_err();
        assert!(failure.contains("超时"));
        assert!(!failure.contains("private-fixture"));
        tokio::time::timeout(Duration::from_secs(1), server)
            .await
            .expect("deadline closes the socket instead of leaking a driver")
            .unwrap();
    }
}
