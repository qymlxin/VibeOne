use super::Workbench;
use crate::domain_error::{DomainError, ErrorKind};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

fn classify(data: &[u8], claimed: &str) -> Result<(&'static str, String), String> {
    let image = if data.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if data.starts_with(b"\xff\xd8\xff") {
        Some("image/jpeg")
    } else if data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if data.len() >= 12 && data.starts_with(b"RIFF") && &data[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    };
    if let Some(mime) = image {
        return Ok(("image", mime.into()));
    }
    if claimed.starts_with("image/") {
        return Err("图片类型或文件头无效；支持PNG、JPEG、GIF与WebP，SVG请作为文本文件提供".into());
    }
    if !data.contains(&0) && std::str::from_utf8(data).is_ok() && data.len() <= 32768 {
        return Ok(("text", "text/plain".into()));
    }
    let mime = if !claimed.is_empty()
        && claimed.len() < 128
        && claimed
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"/.-+".contains(&byte))
    {
        claimed
    } else {
        "application/octet-stream"
    };
    Ok(("resource", mime.into()))
}
impl Workbench {
    pub(crate) async fn upload_attachment(
        &self,
        id: &str,
        name: &str,
        mime: &str,
        encoded: &str,
    ) -> Result<Value, DomainError> {
        self.command_available()?;
        if encoded.len() > 5_592_408 {
            return Err(DomainError::new(
                ErrorKind::AttachmentTooLarge,
                "单个附件不能超过4MiB",
            ));
        }
        let data = STANDARD
            .decode(encoded)
            .map_err(|_| DomainError::new(ErrorKind::InvalidAttachment, "附件Base64编码无效"))?;
        if data.len() > 4 * 1024 * 1024 {
            return Err(DomainError::new(
                ErrorKind::AttachmentTooLarge,
                "单个附件不能超过4MiB",
            ));
        }
        let (kind, mime) = classify(&data, mime)
            .map_err(|error| DomainError::new(ErrorKind::InvalidAttachment, error))?;
        let name: String = name
            .rsplit(['/', '\\'])
            .next()
            .unwrap_or("attachment")
            .chars()
            .filter(|character| !character.is_control())
            .take(200)
            .collect();
        let name = if name.trim().is_empty() {
            "attachment"
        } else {
            name.trim()
        };
        let entry = self.command_entry(id)?;
        let _gate = entry.gate.lock().await;
        self.command_available()?;
        {
            let view = entry.view.lock().expect("view poisoned");
            if view.history_only || view.archived {
                return Err(DomainError::new(
                    ErrorKind::SessionUnavailable,
                    "请先选择继续使用的上下文，或取消归档后再添加附件",
                ));
            }
        }
        let hash = Sha256::digest(&data)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        self.store
            .put_attachment(id, name, &mime, kind, &hash, &data)
            .await
            .map(|attachment| attachment.metadata())
            .map_err(|error| self.attachment_error(error))
    }
    pub(crate) async fn read_attachment(
        &self,
        id: &str,
        attachment: &str,
    ) -> Result<Value, DomainError> {
        self.command_available()?;
        self.command_entry(id)?;
        let value = self
            .store
            .attachment(id, attachment)
            .await
            .map_err(|error| self.attachment_error(error))?
            .ok_or_else(|| {
                DomainError::new(ErrorKind::AttachmentNotFound, "附件不存在或不属于当前会话")
            })?;
        let mut result = value.metadata();
        result["data"] = json!(STANDARD.encode(value.data));
        Ok(result)
    }
    pub(crate) async fn remove_draft_attachment(
        &self,
        id: &str,
        attachment: &str,
    ) -> Result<Value, DomainError> {
        self.command_available()?;
        let entry = self.command_entry(id)?;
        let _gate = entry.gate.lock().await;
        self.command_available()?;
        let referenced = {
            let view = entry.view.lock().expect("view poisoned");
            view.runs
                .iter()
                .any(|run| run.attachment_ids.iter().any(|item| item == attachment))
        };
        if !referenced {
            self.store
                .remove_attachment(id, attachment)
                .await
                .map_err(|error| self.attachment_error(error))?;
        }
        Ok(json!({"retainedForHistory":referenced}))
    }
    fn attachment_error(&self, error: vibeone_storage::Error) -> DomainError {
        match error {
            vibeone_storage::Error::AttachmentQuota => DomainError::new(
                ErrorKind::AttachmentLimit,
                "附件已达到会话容量上限，请移除未使用的草稿附件或新建会话",
            ),
            error => {
                self.fail_storage(error);
                DomainError::storage()
            }
        }
    }
    pub(super) async fn attachment_metadata(
        &self,
        id: &str,
        ids: &[String],
    ) -> Result<Vec<Value>, DomainError> {
        if ids.len() > 5 {
            return Err(DomainError::new(
                ErrorKind::InvalidAttachment,
                "每轮最多添加5个上传附件",
            ));
        }
        let mut result = vec![];
        let mut total = 0;
        let mut seen = std::collections::HashSet::new();
        for attachment in ids {
            if !seen.insert(attachment) {
                return Err(DomainError::new(
                    ErrorKind::InvalidAttachment,
                    "附件不能重复",
                ));
            }
            let attachment = self
                .store
                .attachment(id, attachment)
                .await
                .map_err(|error| self.attachment_error(error))?
                .ok_or_else(|| {
                    DomainError::new(ErrorKind::InvalidAttachment, "附件不存在或不属于当前会话")
                })?;
            total += attachment.data.len();
            if total > 16 * 1024 * 1024 {
                return Err(DomainError::new(
                    ErrorKind::InvalidAttachment,
                    "每轮上传附件总量不能超过16MiB",
                ));
            }
            result.push(attachment.metadata());
        }
        Ok(result)
    }
    pub(super) async fn attachment_blocks(
        &self,
        id: &str,
        ids: &[String],
        capabilities: &Value,
    ) -> Result<Vec<Value>, DomainError> {
        let mut blocks = vec![];
        for attachment in ids {
            let value = self
                .store
                .attachment(id, attachment)
                .await
                .map_err(|error| self.attachment_error(error))?
                .ok_or_else(|| {
                    DomainError::new(ErrorKind::InvalidAttachment, "附件不存在或不属于当前会话")
                })?;
            match value.kind.as_str(){
    "image"=>{if !capabilities["session"]["prompt"]["image"].is_object(){return Err(DomainError::new(ErrorKind::InvalidAttachment,format!("此Agent未声明图片能力，无法发送附件 {}",value.name)));}blocks.push(json!({"type":"image","mimeType":value.mime_type,"data":STANDARD.encode(&value.data)}));}
    "text"=>blocks.push(json!({"type":"text","text":format!("用户上传的文本文件 {}（固定内容）：\n{}",value.name,String::from_utf8_lossy(&value.data))})),
    _=>{if !capabilities["session"]["prompt"]["embeddedContext"].is_object(){return Err(DomainError::new(ErrorKind::InvalidAttachment,format!("此Agent未声明嵌入文件能力，无法发送附件 {}",value.name)));}blocks.push(json!({"type":"resource","resource":{"uri":format!("vibeone:attachment/{}",value.id),"mimeType":value.mime_type,"blob":STANDARD.encode(&value.data)}}));}
   }
        }
        Ok(blocks)
    }
}

#[cfg(test)]
mod attachment_error_tests {
    use super::*;
    async fn setup() -> (tempfile::TempDir, std::sync::Arc<Workbench>, String) {
        let directory = tempfile::tempdir().unwrap();
        let workbench = Workbench::open(
            directory.path(),
            vec![crate::providers::Provider {
                id: "demo".into(),
                name: "Demo".into(),
                available: true,
                description: String::new(),
                command: std::path::PathBuf::from("unused"),
                args: vec![],
            }],
        )
        .await
        .unwrap();
        let id = workbench
            .create("demo", directory.path().to_str().unwrap(), None)
            .await
            .unwrap();
        (directory, workbench, id)
    }
    #[tokio::test]
    async fn closed_database_keeps_attachment_failure_private_and_stops_new_writes() {
        for action in ["upload", "read", "remove"] {
            let (directory, workbench, id) = setup().await;
            workbench.store.close().await;
            let result = match action {
                "upload" => {
                    workbench
                        .upload_attachment(&id, "x.txt", "text/plain", "eA==")
                        .await
                }
                "read" => workbench.read_attachment(&id, "missing").await,
                _ => workbench.remove_draft_attachment(&id, "missing").await,
            };
            let error = result.unwrap_err();
            assert_eq!(error.kind, ErrorKind::StorageUnavailable);
            assert!(!error.message.contains(directory.path().to_str().unwrap()));
            assert!(workbench.snapshot()["storageError"].is_string());
            assert_eq!(
                workbench.command_available().unwrap_err().kind,
                ErrorKind::StorageUnavailable
            );
            assert!(
                workbench
                    .entry(&id)
                    .unwrap()
                    .view
                    .lock()
                    .unwrap()
                    .runs
                    .is_empty()
            );
            workbench.close().await;
        }
    }
    #[tokio::test]
    async fn real_attachment_quota_is_a_conflict_and_draft_removal_recovers_capacity() {
        let (_directory, workbench, id) = setup().await;
        let sha = Sha256::digest(b"x")
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        let mut first = None;
        for index in 0..500 {
            let attachment = workbench
                .store
                .put_attachment(
                    &id,
                    &format!("file-{index}.txt"),
                    "text/plain",
                    "text",
                    &sha,
                    b"x",
                )
                .await
                .unwrap();
            if first.is_none() {
                first = Some(attachment.id);
            }
        }
        let error = workbench
            .upload_attachment(&id, "overflow.txt", "text/plain", "eA==")
            .await
            .unwrap_err();
        assert_eq!(error.kind, ErrorKind::AttachmentLimit);
        assert!(
            workbench.command_available().is_ok(),
            "quota is not a database failure"
        );
        assert_eq!(
            workbench
                .remove_draft_attachment(&id, &first.unwrap())
                .await
                .unwrap()["retainedForHistory"],
            false
        );
        let uploaded = workbench
            .upload_attachment(&id, "overflow.txt", "text/plain", "eA==")
            .await
            .unwrap();
        assert_eq!(uploaded["name"], "overflow.txt");
        assert_eq!(
            workbench
                .read_attachment(&id, uploaded["id"].as_str().unwrap())
                .await
                .unwrap()["data"],
            "eA=="
        );
        workbench.close().await;
    }
}
