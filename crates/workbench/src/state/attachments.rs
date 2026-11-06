use super::Workbench;
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
    pub async fn upload_attachment(
        &self,
        id: &str,
        name: &str,
        mime: &str,
        encoded: &str,
    ) -> Result<Value, String> {
        self.available()?;
        if encoded.len() > 5_592_408 {
            return Err("单个附件不能超过4MiB".into());
        }
        let data = STANDARD.decode(encoded).map_err(|_| "附件Base64编码无效")?;
        if data.len() > 4 * 1024 * 1024 {
            return Err("单个附件不能超过4MiB".into());
        }
        let (kind, mime) = classify(&data, mime)?;
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
        let entry = self.entry(id)?;
        let _gate = entry.gate.lock().await;
        {
            let view = entry.view.lock().expect("view poisoned");
            if view.history_only || view.archived {
                return Err("请先在新上下文继续，或取消归档后再添加附件".into());
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
            .map_err(|error| error.to_string())
    }
    pub async fn read_attachment(&self, id: &str, attachment: &str) -> Result<Value, String> {
        self.entry(id)?;
        let value = self
            .store
            .attachment(id, attachment)
            .await
            .map_err(|error| error.to_string())?
            .ok_or("附件不存在或不属于当前会话")?;
        let mut result = value.metadata();
        result["data"] = json!(STANDARD.encode(value.data));
        Ok(result)
    }
    pub async fn remove_draft_attachment(
        &self,
        id: &str,
        attachment: &str,
    ) -> Result<Value, String> {
        self.available()?;
        let entry = self.entry(id)?;
        let _gate = entry.gate.lock().await;
        let referenced = {
            let view = entry.view.lock().expect("view poisoned");
            view.runs.iter().any(|run| {
                run["attachmentIds"]
                    .as_array()
                    .is_some_and(|ids| ids.iter().any(|item| item == attachment))
            })
        };
        if !referenced {
            self.store
                .remove_attachment(id, attachment)
                .await
                .map_err(|error| error.to_string())?;
        }
        Ok(json!({"retainedForHistory":referenced}))
    }
    pub(super) async fn attachment_metadata(
        &self,
        id: &str,
        ids: &[String],
    ) -> Result<Vec<Value>, String> {
        if ids.len() > 5 {
            return Err("每轮最多添加5个上传附件".into());
        }
        let mut result = vec![];
        let mut total = 0;
        let mut seen = std::collections::HashSet::new();
        for attachment in ids {
            if !seen.insert(attachment) {
                return Err("附件不能重复".into());
            }
            let attachment = self
                .store
                .attachment(id, attachment)
                .await
                .map_err(|error| error.to_string())?
                .ok_or("附件不存在或不属于当前会话")?;
            total += attachment.data.len();
            if total > 16 * 1024 * 1024 {
                return Err("每轮上传附件总量不能超过16MiB".into());
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
    ) -> Result<Vec<Value>, String> {
        let mut blocks = vec![];
        for attachment in ids {
            let value = self
                .store
                .attachment(id, attachment)
                .await
                .map_err(|error| error.to_string())?
                .ok_or("附件不存在或不属于当前会话")?;
            match value.kind.as_str(){
    "image"=>{if !capabilities["session"]["prompt"]["image"].is_object(){return Err(format!("此Agent未声明图片能力，无法发送附件 {}",value.name));}blocks.push(json!({"type":"image","mimeType":value.mime_type,"data":STANDARD.encode(&value.data)}));}
    "text"=>blocks.push(json!({"type":"text","text":format!("用户上传的文本文件 {}（固定内容）：\n{}",value.name,String::from_utf8_lossy(&value.data))})),
    _=>{if !capabilities["session"]["prompt"]["embeddedContext"].is_object(){return Err(format!("此Agent未声明嵌入文件能力，无法发送附件 {}",value.name));}blocks.push(json!({"type":"resource","resource":{"uri":format!("vibeone:attachment/{}",value.id),"mimeType":value.mime_type,"blob":STANDARD.encode(&value.data)}}));}
   }
        }
        Ok(blocks)
    }
}
