use super::{Result, SavedSession, Store};
use serde::Serialize;
use serde_json::{Value, json};
use sqlx::{Row, Sqlite, Transaction};

#[derive(Serialize)]
struct RecordRef<'a> {
    kind: &'static str,
    item: &'a Value,
}
fn records(snapshot: &Value) -> Vec<RecordRef<'_>> {
    [("message", "messages"), ("tool", "tools")]
        .into_iter()
        .flat_map(|(kind, key)| {
            snapshot[key]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|item| item["historyOrder"].as_u64().is_some_and(|order| order > 0))
                .map(move |item| RecordRef { kind, item })
        })
        .collect()
}
async fn write_records(tx: &mut Transaction<'_, Sqlite>, id: &str, snapshot: &Value) -> Result<()> {
    let encoded = serde_json::to_string(&records(snapshot))?;
    sqlx::query("INSERT INTO conversation_records(session_id,history_order,history_revision,kind,record_id,role,run_id,pending,snapshot) SELECT ?,json_extract(value,'$.item.historyOrder'),COALESCE(json_extract(value,'$.item.historyRevision'),0),json_extract(value,'$.kind'),CASE WHEN json_extract(value,'$.kind')='tool' THEN COALESCE(json_extract(value,'$.item.toolCallId'),'') ELSE COALESCE(json_extract(value,'$.item.id'),'') END,CASE WHEN json_extract(value,'$.kind')='tool' THEN '' ELSE COALESCE(json_extract(value,'$.item.role'),'') END,COALESCE(json_extract(value,'$.item.runId'),''),COALESCE(json_extract(value,'$.item.pending'),0),json_extract(value,'$.item') FROM json_each(?) WHERE json_extract(value,'$.item.historyOrder')>0 ON CONFLICT(session_id,history_order) DO UPDATE SET history_revision=excluded.history_revision,kind=excluded.kind,record_id=excluded.record_id,role=excluded.role,run_id=excluded.run_id,pending=excluded.pending,snapshot=excluded.snapshot WHERE excluded.history_revision >= conversation_records.history_revision AND (excluded.snapshot != conversation_records.snapshot OR excluded.kind != conversation_records.kind)")
 .bind(id).bind(encoded).execute(&mut **tx).await?;
    Ok(())
}
async fn settle_pending(tx: &mut Transaction<'_, Sqlite>, saved: &SavedSession) -> Result<()> {
    let runs = serde_json::to_string(&saved.snapshot["runs"])?;
    sqlx::query("WITH finished AS (SELECT json_extract(value,'$.id') AS id,json_extract(value,'$.status') AS status FROM json_each(?) WHERE json_extract(value,'$.status') IN ('completed','cancelled','failed','interrupted')) UPDATE conversation_records SET pending=0,history_revision=?,snapshot=json_set(snapshot,'$.pending',json('false'),'$.delivery',CASE (SELECT status FROM finished WHERE finished.id=conversation_records.run_id) WHEN 'completed' THEN 'accepted' WHEN 'interrupted' THEN 'interrupted' ELSE 'unconfirmed' END,'$.historyRevision',?) WHERE session_id=? AND pending=1 AND run_id IN (SELECT id FROM finished)")
        .bind(runs).bind(saved.revision).bind(saved.revision).bind(&saved.id).execute(&mut **tx).await?;
    Ok(())
}
pub(super) async fn save_projection(
    tx: &mut Transaction<'_, Sqlite>,
    session: &SavedSession,
    kind: &str,
) -> Result<()> {
    if kind == "session.created"
        && session.snapshot["messages"]
            .as_array()
            .is_some_and(Vec::is_empty)
        && session.snapshot["tools"]
            .as_array()
            .is_some_and(Vec::is_empty)
    {
        sqlx::query("INSERT INTO conversation_history_state(session_id,state) VALUES(?,?) ON CONFLICT(session_id) DO NOTHING").bind(&session.id).bind("{\"complete\":true,\"warnings\":[]}").execute(&mut **tx).await?;
    }
    let ready=sqlx::query_scalar::<_,i64>("SELECT COALESCE(json_extract(state,'$.complete'),0) FROM conversation_history_state WHERE session_id=?").bind(&session.id).fetch_optional(&mut **tx).await?.unwrap_or(0);
    if ready == 1 {
        write_records(tx, &session.id, &session.snapshot).await?;
        if !matches!(
            session.snapshot["status"].as_str(),
            Some("starting" | "running" | "requires_action" | "cancelling")
        ) {
            settle_pending(tx, session).await?;
        }
    }
    Ok(())
}
impl Store {
    pub async fn history_checkpoint(&self, id: &str) -> Result<Option<Value>> {
        sqlx::query_scalar::<_, String>(
            "SELECT state FROM conversation_history_state WHERE session_id=?",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?
        .map(|value| serde_json::from_str(&value).map_err(Into::into))
        .transpose()
    }
    pub async fn history_event(&self, id: &str, after: u64) -> Result<Option<Value>> {
        sqlx::query("SELECT seq,kind,payload FROM event_log WHERE session_id=? AND seq>? ORDER BY seq LIMIT 1").bind(id).bind(after as i64).fetch_optional(&self.pool).await?.map(|row|Ok(json!({"seq":row.try_get::<i64,_>("seq")?,"kind":row.try_get::<String,_>("kind")?,"payload":serde_json::from_str::<Value>(&row.try_get::<String,_>("payload")?)?}))).transpose()
    }
    pub async fn history_record(
        &self,
        id: &str,
        kind: &str,
        record: &str,
        role: &str,
        run: Option<&str>,
    ) -> Result<Option<Value>> {
        sqlx::query_scalar::<_,String>("SELECT snapshot FROM conversation_records WHERE session_id=? AND kind=? AND record_id=? AND role=? AND (? IS NULL OR run_id=?) ORDER BY history_order DESC LIMIT 1").bind(id).bind(kind).bind(record).bind(role).bind(run).bind(run).fetch_optional(&self.pool).await?.map(|text|serde_json::from_str(&text).map_err(Into::into)).transpose()
    }
    pub async fn history_pending(&self, id: &str, run: &str) -> Result<Option<Value>> {
        sqlx::query_scalar::<_,String>("SELECT snapshot FROM conversation_records WHERE session_id=? AND kind='message' AND role='user' AND run_id=? AND pending=1 ORDER BY history_order DESC LIMIT 1").bind(id).bind(run).fetch_optional(&self.pool).await?.map(|text|serde_json::from_str(&text).map_err(Into::into)).transpose()
    }
    pub async fn history_page(&self, id: &str, before: Option<u64>, limit: u16) -> Result<Value> {
        let limit = limit.clamp(1, 256) as usize;
        let rows=sqlx::query("SELECT kind,snapshot FROM conversation_records WHERE session_id=? AND history_order<? ORDER BY history_order DESC LIMIT ?").bind(id).bind(before.unwrap_or(i64::MAX as u64).min(i64::MAX as u64) as i64).bind((limit+1) as i64).fetch_all(&self.pool).await?;
        let more = rows.len() > limit;
        let mut items=rows.into_iter().take(limit).map(|row|Ok(json!({"kind":row.try_get::<String,_>("kind")?,"item":serde_json::from_str::<Value>(&row.try_get::<String,_>("snapshot")?)?}))).collect::<Result<Vec<_>>>()?;
        items.reverse();
        let next = items
            .first()
            .and_then(|record| record["item"]["historyOrder"].as_u64());
        let warnings = self
            .history_checkpoint(id)
            .await?
            .and_then(|state| state.get("warnings").cloned())
            .unwrap_or_else(|| json!([]));
        Ok(json!({"records":items,"hasMore":more,"nextBefore":next,"warnings":warnings}))
    }
    pub async fn history_latest(&self, id: &str, kind: &str) -> Result<Vec<Value>> {
        let rows=sqlx::query_scalar::<_,String>("SELECT snapshot FROM conversation_records WHERE session_id=? AND kind=? ORDER BY history_order DESC LIMIT ?").bind(id).bind(kind).bind(if kind=="tool"{100_i64}else{128_i64}).fetch_all(&self.pool).await?;
        rows.into_iter()
            .rev()
            .map(|text| serde_json::from_str(&text).map_err(Into::into))
            .collect()
    }
    pub async fn history_batch(&self, id: &str, snapshot: &Value, state: &Value) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        write_records(&mut tx, id, snapshot).await?;
        sqlx::query("INSERT INTO conversation_history_state(session_id,state) VALUES(?,?) ON CONFLICT(session_id) DO UPDATE SET state=excluded.state").bind(id).bind(serde_json::to_string(state)?).execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(())
    }
    pub async fn history_finish(&self, saved: &SavedSession, state: &Value) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        write_records(&mut tx, &saved.id, &saved.snapshot).await?;
        settle_pending(&mut tx, saved).await?;
        let updated = sqlx::query(
            "UPDATE sessions SET snapshot=? WHERE id=? AND revision=? AND workspace_path=?",
        )
        .bind(serde_json::to_string(&saved.snapshot)?)
        .bind(&saved.id)
        .bind(saved.revision)
        .bind(&saved.workspace)
        .execute(&mut *tx)
        .await?;
        if updated.rows_affected() != 1 {
            return Err(super::Error::Conflict);
        }
        sqlx::query("INSERT INTO conversation_history_state(session_id,state) VALUES(?,?) ON CONFLICT(session_id) DO UPDATE SET state=excluded.state").bind(&saved.id).bind(serde_json::to_string(state)?).execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(())
    }
}
