//! Embedded SQLite persistence. A committed session projection and its event share one transaction.
mod attachments;
mod history;
pub use attachments::Attachment;
use serde::Serialize;
use serde_json::{Value, json};
use sqlx::{
    Row, SqlitePool,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous},
};
use std::{path::Path, time::Duration};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("附件超过限制：单文件4MiB，每会话最多500个附件且总量256MiB")]
    AttachmentQuota,
    #[error("数据库访问失败：{0}")]
    Database(#[from] sqlx::Error),
    #[error("数据库版本或迁移不兼容：{0}")]
    Migration(#[from] sqlx::migrate::MigrateError),
    #[error("存储记录无效：{0}")]
    Json(#[from] serde_json::Error),
    #[error("本地存储目录不可用：{0}")]
    Io(#[from] std::io::Error),
    #[error("会话状态版本冲突")]
    Conflict,
    #[error("会话身份或工作区不匹配")]
    Identity,
}
pub type Result<T> = std::result::Result<T, Error>;

#[derive(Clone, Serialize)]
pub struct Workspace {
    pub id: String,
    pub path: String,
    pub name: String,
}
pub struct SavedSession {
    pub id: String,
    pub workspace: String,
    pub revision: i64,
    pub snapshot: Value,
}
#[derive(Clone)]
pub struct Store {
    pool: SqlitePool,
}

impl Store {
    pub async fn open(directory: &Path) -> Result<Self> {
        std::fs::create_dir_all(directory)?;
        let path = directory.join("vibeone.sqlite3");
        let options = SqliteConnectOptions::new()
            .filename(&path)
            .create_if_missing(true)
            .foreign_keys(true)
            .journal_mode(SqliteJournalMode::Wal)
            .synchronous(SqliteSynchronous::Full)
            .busy_timeout(Duration::from_secs(5));
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
        }
        sqlx::migrate!("./migrations").run(&pool).await?;
        Ok(Self { pool })
    }

    pub async fn save(&self, session: &SavedSession, kind: &str, event: &Value) -> Result<u64> {
        self.save_with_creation_receipt(session, kind, event, None)
            .await
    }

    /// A creation receipt and its session must become visible in one commit.
    pub async fn save_with_creation_receipt(
        &self,
        session: &SavedSession,
        kind: &str,
        event: &Value,
        receipt: Option<(&str, &Value)>,
    ) -> Result<u64> {
        if session.snapshot["id"] != session.id
            || session.snapshot["workspace"] != session.workspace
        {
            return Err(Error::Identity);
        }
        let mut tx = self.pool.begin().await?;
        let workspace_id = uuid::Uuid::new_v4().to_string();
        let name = Path::new(&session.workspace)
            .file_name()
            .unwrap_or_default()
            .to_string_lossy();
        sqlx::query(
            "INSERT INTO workspaces(id,path,name) VALUES(?,?,?) ON CONFLICT(path) DO NOTHING",
        )
        .bind(workspace_id)
        .bind(&session.workspace)
        .bind(name.as_ref())
        .execute(&mut *tx)
        .await?;
        let result=sqlx::query("INSERT INTO sessions(id,workspace_path,revision,snapshot) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,snapshot=excluded.snapshot,updated_at=unixepoch() WHERE sessions.revision < excluded.revision AND sessions.workspace_path=excluded.workspace_path")
            .bind(&session.id).bind(&session.workspace).bind(session.revision).bind(serde_json::to_string(&session.snapshot)?).execute(&mut *tx).await?;
        if result.rows_affected() != 1 {
            return Err(Error::Conflict);
        }
        let seq = sqlx::query("INSERT INTO event_log(session_id,kind,payload) VALUES(?,?,?)")
            .bind(&session.id)
            .bind(kind)
            .bind(serde_json::to_string(event)?)
            .execute(&mut *tx)
            .await?
            .last_insert_rowid();
        let notification = if matches!(event["type"].as_str(), Some("permission" | "input")) {
            Some("attention.created")
        } else if kind == "run.ended" || kind == "agent.update" && event["runEnded"] == true {
            Some("run.ended")
        } else if kind == "run.failed" {
            Some("queue.paused")
        } else if kind == "session.recovered" && event["interrupted"] == true {
            Some("run.interrupted")
        } else {
            None
        };
        if let Some(kind) = notification {
            let id = format!("notification-{seq}");
            let payload = json!({"eventId":id,"type":kind,"sessionId":session.id,"workspace":session.workspace,"requestId":event["id"],"runId":session.snapshot["runs"].as_array().and_then(|runs|runs.iter().rev().find(|run|run["status"]!="queued")).map(|run|&run["id"]),"status":session.snapshot["status"]});
            sqlx::query("INSERT INTO notification_outbox(id,session_id,payload) VALUES(?,?,?)")
                .bind(&id)
                .bind(&session.id)
                .bind(serde_json::to_string(&payload)?)
                .execute(&mut *tx)
                .await?;
        }
        history::save_projection(&mut tx, session, kind).await?;
        if let Some((id, value)) = receipt {
            sqlx::query("INSERT INTO catalog(kind,id,value) VALUES('session-create',?,?)")
                .bind(id)
                .bind(serde_json::to_string(value)?)
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
        Ok(seq as u64)
    }

    pub async fn sessions(&self) -> Result<Vec<SavedSession>> {
        let rows = sqlx::query(
            "SELECT id,workspace_path,revision,snapshot FROM sessions ORDER BY updated_at,id",
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|row| {
                Ok(SavedSession {
                    id: row.try_get("id")?,
                    workspace: row.try_get("workspace_path")?,
                    revision: row.try_get("revision")?,
                    snapshot: serde_json::from_str(row.try_get("snapshot")?)?,
                })
            })
            .collect()
    }
    pub async fn workspaces(&self) -> Result<Vec<Workspace>> {
        sqlx::query("SELECT id,path,name FROM workspaces ORDER BY created_at,id")
            .fetch_all(&self.pool)
            .await?
            .into_iter()
            .map(|row| {
                Ok(Workspace {
                    id: row.try_get("id")?,
                    path: row.try_get("path")?,
                    name: row.try_get("name")?,
                })
            })
            .collect()
    }
    pub async fn import_workspace(&self, path: &str) -> Result<u64> {
        let mut tx = self.pool.begin().await?;
        let name = Path::new(path)
            .file_name()
            .unwrap_or_default()
            .to_string_lossy();
        sqlx::query(
            "INSERT INTO workspaces(id,path,name) VALUES(?,?,?) ON CONFLICT(path) DO NOTHING",
        )
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(path)
        .bind(name.as_ref())
        .execute(&mut *tx)
        .await?;
        let cursor =
            sqlx::query("INSERT INTO event_log(kind,payload) VALUES('workspace.imported','{}')")
                .execute(&mut *tx)
                .await?
                .last_insert_rowid();
        tx.commit().await?;
        Ok(cursor as u64)
    }
    pub async fn catalog(&self) -> Result<Vec<(String, String, Value)>> {
        sqlx::query("SELECT kind,id,value FROM catalog")
            .fetch_all(&self.pool)
            .await?
            .into_iter()
            .map(|row| {
                Ok((
                    row.try_get("kind")?,
                    row.try_get("id")?,
                    serde_json::from_str(row.try_get("value")?)?,
                ))
            })
            .collect()
    }
    pub async fn put_catalog(&self, kind: &str, id: &str, value: &Value) -> Result<u64> {
        let mut tx = self.pool.begin().await?;
        if value.is_null() {
            sqlx::query("DELETE FROM catalog WHERE kind=? AND id=?")
                .bind(kind)
                .bind(id)
                .execute(&mut *tx)
                .await?;
        } else {
            sqlx::query("INSERT INTO catalog(kind,id,value) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET value=excluded.value,updated_at=unixepoch()")
            .bind(kind).bind(id).bind(serde_json::to_string(value)?).execute(&mut *tx).await?;
        }
        let cursor = sqlx::query("INSERT INTO event_log(kind,payload) VALUES(?,?)")
            .bind(format!("{kind}.updated"))
            .bind(serde_json::to_string(&json!({"id":id}))?)
            .execute(&mut *tx)
            .await?
            .last_insert_rowid();
        tx.commit().await?;
        Ok(cursor as u64)
    }
    pub async fn events(&self, after: u64, limit: u32) -> Result<Vec<Value>> {
        sqlx::query("SELECT seq,session_id,kind,payload,created_at FROM event_log WHERE seq>? ORDER BY seq LIMIT ?")
            .bind(after as i64).bind(limit.min(256)).fetch_all(&self.pool).await?.into_iter().map(|row|Ok(json!({
                "id":format!("event-{}",row.try_get::<i64,_>("seq")?),"cursor":row.try_get::<i64,_>("seq")?,"sessionId":row.try_get::<Option<String>,_>("session_id")?,
                "kind":row.try_get::<String,_>("kind")?,"payload":serde_json::from_str::<Value>(row.try_get("payload")?)?,"createdAt":row.try_get::<i64,_>("created_at")?
            }))).collect()
    }
    pub async fn cursor(&self) -> Result<u64> {
        Ok(
            sqlx::query_scalar::<_, i64>("SELECT COALESCE(MAX(seq),0) FROM event_log")
                .fetch_one(&self.pool)
                .await? as u64,
        )
    }

    /// Only identities and committed sequence numbers; do not load protocol payloads.
    pub async fn changed_sessions(&self, after: u64, through: u64) -> Result<Vec<(String, u64)>> {
        sqlx::query("SELECT session_id,MAX(seq) AS seq FROM event_log WHERE seq>? AND seq<=? AND session_id IS NOT NULL GROUP BY session_id")
            .bind(after as i64).bind(through as i64).fetch_all(&self.pool).await?
            .into_iter().map(|row| Ok((row.try_get("session_id")?, row.try_get::<i64,_>("seq")? as u64))).collect()
    }

    /// Called only after the Host's instance lock is held, before accepting clients.
    pub async fn recover(&self) -> Result<()> {
        sqlx::query("UPDATE notification_outbox SET state='obsolete' WHERE state='pending' AND json_extract(payload,'$.type')='attention.created'").execute(&self.pool).await?;
        let records = self.sessions().await?;
        for mut session in records {
            // Earlier projections predate execution lists. Mutable JSON indexing used to
            // materialize absent fields as null, so accept both forms during recovery.
            for field in ["runs", "queue", "decisions"] {
                if session.snapshot[field].is_null() {
                    session.snapshot[field] = json!([]);
                }
            }
            let active = matches!(
                session.snapshot["status"].as_str(),
                Some("starting" | "running" | "requires_action" | "cancelling")
            );
            session.snapshot["approvals"] = json!([]);
            session.snapshot["inputs"] = json!([]);
            session.snapshot["queuePaused"] = json!(
                session.snapshot["queue"]
                    .as_array()
                    .is_some_and(|items| !items.is_empty())
            );
            if let Some(runs) = session.snapshot["runs"].as_array_mut() {
                for run in runs {
                    if matches!(
                        run["status"].as_str(),
                        Some("starting" | "running" | "requires_action" | "cancelling")
                    ) {
                        run["status"] = json!("interrupted");
                    }
                }
            }
            if let Some(decisions) = session.snapshot["decisions"].as_array_mut() {
                for decision in decisions {
                    if decision["delivery"] == "pending" {
                        decision["delivery"] = json!("uncertain");
                    }
                }
            }
            session.snapshot["historyOnly"] = json!(
                session.snapshot["messages"]
                    .as_array()
                    .is_some_and(|messages| !messages.is_empty())
            );
            if active {
                session.snapshot["status"] = json!("interrupted");
                session.snapshot["stopReason"] = json!("interrupted");
                session.snapshot["error"] =
                    json!("Host 已重启，上一轮执行已中断；历史已保留，请新建会话开始新的执行。");
            }
            if let Some(messages) = session.snapshot["messages"].as_array_mut() {
                for message in messages {
                    if message["pending"] == true {
                        message["pending"] = json!(false);
                        message["delivery"] = json!("interrupted");
                        message["historyRevision"] = json!(session.revision + 1);
                    }
                }
            }
            session.revision += 1;
            self.save(
                &session,
                "session.recovered",
                &json!({"interrupted":active}),
            )
            .await?;
        }
        Ok(())
    }
    pub async fn pending_notifications(&self) -> Result<Vec<Value>> {
        sqlx::query("SELECT id,session_id,payload,attempts FROM notification_outbox WHERE state='pending' AND available_at<=unixepoch() ORDER BY available_at,id LIMIT 32").fetch_all(&self.pool).await?.into_iter().map(|row|Ok(json!({"id":row.try_get::<String,_>("id")?,"sessionId":row.try_get::<String,_>("session_id")?,"payload":serde_json::from_str::<Value>(row.try_get("payload")?)?,"attempts":row.try_get::<i64,_>("attempts")?}))).collect()
    }
    pub async fn notification_result(&self, id: &str, state: &str, attempts: u32) -> Result<()> {
        sqlx::query("UPDATE notification_outbox SET state=?,attempts=?,available_at=unixepoch()+? WHERE id=?").bind(state).bind(attempts).bind(2_i64.pow(attempts.min(8))).bind(id).execute(&self.pool).await?;
        Ok(())
    }
    pub async fn notification_counts(&self) -> Result<Value> {
        let rows =
            sqlx::query("SELECT state,COUNT(*) AS count FROM notification_outbox GROUP BY state")
                .fetch_all(&self.pool)
                .await?;
        let mut counts = json!({"pending":0,"delivered":0,"failed":0,"obsolete":0});
        for row in rows {
            counts[row.try_get::<String, _>("state")?] = json!(row.try_get::<i64, _>("count")?);
        }
        Ok(counts)
    }
    pub async fn close(&self) {
        self.pool.close().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn record(revision: i64, status: &str) -> SavedSession {
        SavedSession {
            id: "a".into(),
            workspace: "/workspace".into(),
            revision,
            snapshot: json!({"id":"a","workspace":"/workspace","status":status,"messages":[{"id":"user","role":"user","text":"accepted","pending":true}],"approvals":[{"id":"old-request"}]}),
        }
    }
    #[tokio::test]
    async fn transactions_reject_stale_versions_and_survive_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).await.unwrap();
        store
            .save(&record(2, "idle"), "created", &json!({}))
            .await
            .unwrap();
        assert!(matches!(
            store.save(&record(1, "running"), "stale", &json!({})).await,
            Err(Error::Conflict)
        ));
        assert_eq!(store.cursor().await.unwrap(), 1);
        assert_eq!(store.workspaces().await.unwrap().len(), 1);
        store.close().await;
        let reopened = Store::open(dir.path()).await.unwrap();
        assert_eq!(reopened.sessions().await.unwrap()[0].revision, 2);
        reopened.close().await;
    }
    #[tokio::test]
    async fn creation_receipt_failure_rolls_back_session_workspace_and_event() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).await.unwrap();
        sqlx::query("CREATE TRIGGER fail_receipt BEFORE INSERT ON catalog WHEN NEW.kind='session-create' BEGIN SELECT RAISE(ABORT,'injected receipt failure'); END").execute(&store.pool).await.unwrap();
        assert!(
            store
                .save_with_creation_receipt(
                    &record(1, "idle"),
                    "session.created",
                    &json!({}),
                    Some(("intent", &json!({"sessionId":"one"})))
                )
                .await
                .is_err()
        );
        assert!(store.sessions().await.unwrap().is_empty());
        assert!(store.workspaces().await.unwrap().is_empty());
        assert!(store.catalog().await.unwrap().is_empty());
        assert_eq!(store.cursor().await.unwrap(), 0);
        sqlx::query("DROP TRIGGER fail_receipt")
            .execute(&store.pool)
            .await
            .unwrap();
        store
            .save_with_creation_receipt(
                &record(1, "idle"),
                "session.created",
                &json!({}),
                Some(("intent", &json!({"sessionId":"one"}))),
            )
            .await
            .unwrap();
        store.close().await;
        let reopened = Store::open(dir.path()).await.unwrap();
        assert_eq!(reopened.sessions().await.unwrap().len(), 1);
        assert_eq!(reopened.catalog().await.unwrap()[0].0, "session-create");
        reopened.close().await;
    }
    #[tokio::test]
    async fn restart_invalidates_requests_and_never_replays_pending_input() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).await.unwrap();
        store
            .save(&record(1, "requires_action"), "created", &json!({}))
            .await
            .unwrap();
        store.recover().await.unwrap();
        let saved = store.sessions().await.unwrap().remove(0);
        assert_eq!(saved.snapshot["status"], "interrupted");
        assert_eq!(saved.snapshot["approvals"], json!([]));
        assert_eq!(saved.snapshot["messages"][0]["delivery"], "interrupted");
        assert_eq!(saved.snapshot["historyOnly"], true);
        store.close().await;
    }
    #[tokio::test]
    async fn notification_outbox_is_atomic_persistent_and_obsoletes_old_attention() {
        let directory = tempfile::tempdir().unwrap();
        let store = Store::open(directory.path()).await.unwrap();
        store
            .save(
                &record(1, "requires_action"),
                "agent.update",
                &json!({"type":"permission","id":"old-request"}),
            )
            .await
            .unwrap();
        let pending = store.pending_notifications().await.unwrap();
        assert_eq!(pending.len(), 1);
        let id = pending[0]["id"].clone();
        assert!(
            store
                .save(
                    &record(1, "requires_action"),
                    "agent.update",
                    &json!({"type":"permission","id":"old-request"})
                )
                .await
                .is_err()
        );
        assert_eq!(store.pending_notifications().await.unwrap().len(), 1);
        store.close().await;
        let store = Store::open(directory.path()).await.unwrap();
        assert_eq!(store.pending_notifications().await.unwrap()[0]["id"], id);
        store.recover().await.unwrap();
        assert!(
            store
                .pending_notifications()
                .await
                .unwrap()
                .iter()
                .all(|record| record["payload"]["type"] != "attention.created")
        );
        assert_eq!(store.notification_counts().await.unwrap()["obsolete"], 1);
        store.close().await;
    }
    #[tokio::test]
    async fn future_schema_is_rejected_without_resetting_database() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).await.unwrap();
        sqlx::query("INSERT INTO _sqlx_migrations(version,description,success,checksum,execution_time) VALUES(999,'future',1,x'00',0)").execute(&store.pool).await.unwrap();
        store.close().await;
        assert!(matches!(
            Store::open(dir.path()).await,
            Err(Error::Migration(_))
        ));
        assert!(dir.path().join("vibeone.sqlite3").is_file());
    }
}
