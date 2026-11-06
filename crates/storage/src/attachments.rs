use super::{Result, Store};
use serde_json::{Value, json};
use sqlx::Row;

pub struct Attachment {
    pub id: String,
    pub name: String,
    pub mime_type: String,
    pub kind: String,
    pub data: Vec<u8>,
}
impl Attachment {
    pub fn metadata(&self) -> Value {
        json!({"id":self.id,"name":self.name,"mimeType":self.mime_type,"kind":self.kind,"size":self.data.len()})
    }
}
fn record(row: sqlx::sqlite::SqliteRow) -> Result<Attachment> {
    Ok(Attachment {
        id: row.try_get("id")?,
        name: row.try_get("name")?,
        mime_type: row.try_get("mime_type")?,
        kind: row.try_get("kind")?,
        data: row.try_get("data")?,
    })
}
impl Store {
    pub async fn attachment(&self, session: &str, id: &str) -> Result<Option<Attachment>> {
        sqlx::query(
            "SELECT id,name,mime_type,kind,data FROM attachments WHERE session_id=? AND id=?",
        )
        .bind(session)
        .bind(id)
        .fetch_optional(&self.pool)
        .await?
        .map(record)
        .transpose()
    }
    pub async fn put_attachment(
        &self,
        session: &str,
        name: &str,
        mime: &str,
        kind: &str,
        sha: &str,
        data: &[u8],
    ) -> Result<Attachment> {
        if data.len() > 4 * 1024 * 1024 {
            return Err(super::Error::AttachmentQuota);
        }
        let mut tx = self.pool.begin().await?;
        if let Some(row)=sqlx::query("SELECT id,name,mime_type,kind,data FROM attachments WHERE session_id=? AND sha256=? AND name=?").bind(session).bind(sha).bind(name).fetch_optional(&mut *tx).await? {return record(row);}
        let quota=sqlx::query("SELECT COUNT(*) AS count,COALESCE(SUM(size),0) AS size FROM attachments WHERE session_id=?").bind(session).fetch_one(&mut *tx).await?;
        if quota.try_get::<i64, _>("count")? >= 500
            || quota.try_get::<i64, _>("size")? + data.len() as i64 > 256 * 1024 * 1024
        {
            return Err(super::Error::AttachmentQuota);
        }
        let attachment = Attachment {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.into(),
            mime_type: mime.into(),
            kind: kind.into(),
            data: data.to_vec(),
        };
        sqlx::query("INSERT INTO attachments(id,session_id,name,mime_type,kind,sha256,size,data) VALUES(?,?,?,?,?,?,?,?)").bind(&attachment.id).bind(session).bind(name).bind(mime).bind(kind).bind(sha).bind(data.len() as i64).bind(data).execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(attachment)
    }
    pub async fn remove_attachment(&self, session: &str, id: &str) -> Result<()> {
        sqlx::query("DELETE FROM attachments WHERE session_id=? AND id=?")
            .bind(session)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}
