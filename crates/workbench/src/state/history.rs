use super::*;
use vibeone_storage::Store;

pub(super) fn stamp(
    view: &mut SessionView,
    previous: &SessionView,
    revision: u64,
) -> Result<(), String> {
    let old: HashMap<u64, &Value> = previous
        .messages
        .iter()
        .chain(&previous.tools)
        .filter_map(|item| item["historyOrder"].as_u64().map(|order| (order, item)))
        .collect();
    let mut sequence = view.history_sequence;
    for item in view.messages.iter_mut().chain(&mut view.tools) {
        let order = if let Some(order) = item["historyOrder"].as_u64().filter(|order| *order > 0) {
            sequence = sequence.max(order);
            order
        } else {
            let inherited =
                if item["role"] == "user" && item["pending"] != true && item["runId"].is_string() {
                    previous
                        .messages
                        .iter()
                        .find(|old| {
                            old["role"] == "user"
                                && old["pending"] == true
                                && old["runId"] == item["runId"]
                        })
                        .and_then(|old| old["historyOrder"].as_u64())
                } else {
                    None
                };
            if let Some(order) = inherited {
                order
            } else {
                sequence = sequence
                    .checked_add(1)
                    .filter(|order| *order < i64::MAX as u64)
                    .ok_or("历史序号已达到上限")?;
                sequence
            }
        };
        item["historyOrder"] = json!(order);
        item["activityOrder"] = json!(order);
        if item["updatedOrder"].is_null() {
            item["updatedOrder"] = json!(revision);
        }
        if old.get(&order).is_none_or(|old| *old != item) {
            item["historyRevision"] = json!(revision);
        }
    }
    view.history_sequence = sequence;
    view.messages
        .sort_by_key(|item| item["historyOrder"].as_u64());
    view.tools.sort_by_key(|item| item["historyOrder"].as_u64());
    Ok(())
}
fn event_record(event: &Value) -> Option<(&'static str, &str, &'static str)> {
    if event["type"] != "update" {
        return None;
    }
    let update = &event["notification"]["update"];
    let kind = update["sessionUpdate"].as_str()?;
    if kind == "tool_call_update" || kind == "tool_call_content_chunk" {
        return Some(("tool", update["toolCallId"].as_str()?, ""));
    }
    let role = match kind {
        "user_message" | "user_message_chunk" => "user",
        "agent_message" | "agent_message_chunk" => "assistant",
        "agent_thought" | "agent_thought_chunk" => "thought",
        _ => return None,
    };
    Some(("message", update["messageId"].as_str()?, role))
}
pub(super) async fn restore(
    store: &Store,
    view: &mut SessionView,
    event: &Value,
    run: Option<&str>,
    replay: bool,
) -> Result<Option<u64>, String> {
    let Some((kind, id, role)) = event_record(event) else {
        return Ok(None);
    };
    let key = if kind == "tool" { "toolCallId" } else { "id" };
    let list = if kind == "tool" {
        &mut view.tools
    } else {
        &mut view.messages
    };
    if !list
        .iter()
        .any(|item| item[key] == id && (kind == "tool" || item["role"] == role))
    {
        let saved = store
            .history_record(&view.id, kind, id, role, if replay { run } else { None })
            .await
            .map_err(|error| error.to_string())?;
        if let Some(saved) = saved {
            list.push(saved);
        }
    }
    if role == "user" {
        let pending = view
            .messages
            .iter()
            .find(|item| {
                item["pending"] == true && (run.is_none() || item["runId"].as_str() == run)
            })
            .cloned();
        let pending = if pending.is_some() {
            pending
        } else if let Some(run) = run {
            store
                .history_pending(&view.id, run)
                .await
                .map_err(|error| error.to_string())?
        } else {
            None
        };
        return Ok(pending.and_then(|item| item["historyOrder"].as_u64()));
    }
    Ok(None)
}
pub(super) fn annotate(
    view: &mut SessionView,
    event: &Value,
    run: Option<&str>,
    inherited: Option<u64>,
    revision: u64,
) {
    let Some((kind, id, role)) = event_record(event) else {
        return;
    };
    let key = if kind == "tool" { "toolCallId" } else { "id" };
    let attachments = view
        .runs
        .iter()
        .find(|item| Some(item.id.as_str()) == run)
        .map(|item| json!(item.attachments));
    let list = if kind == "tool" {
        &mut view.tools
    } else {
        &mut view.messages
    };
    if let Some(item) = list
        .iter_mut()
        .find(|item| item[key] == id && (kind == "tool" || item["role"] == role))
    {
        if item["runId"].is_null() {
            item["runId"] = json!(run);
        }
        if role == "user" {
            if item["historyOrder"].is_null()
                && let Some(order) = inherited
            {
                item["historyOrder"] = json!(order);
            }
            if let Some(attachments) = attachments {
                item["attachments"] = attachments;
            }
        }
        item["updatedOrder"] = json!(revision);
    }
}
fn restore_buffered(
    view: &mut SessionView,
    event: &Value,
    run: Option<&str>,
    buffered: &HashMap<u64, (bool, Value)>,
) {
    let Some((kind, id, role)) = event_record(event) else {
        return;
    };
    let tool = kind == "tool";
    let key = if tool { "toolCallId" } else { "id" };
    let list = if tool {
        &mut view.tools
    } else {
        &mut view.messages
    };
    if list
        .iter()
        .any(|item| item[key] == id && (tool || item["role"] == role))
    {
        return;
    }
    if let Some((_, item)) = buffered
        .values()
        .filter(|(is_tool, item)| {
            *is_tool == tool
                && item[key] == id
                && (tool || item["role"] == role)
                && run.is_none_or(|run| item["runId"] == run)
        })
        .max_by_key(|(_, item)| item["historyOrder"].as_u64())
    {
        list.push(item.clone());
    }
}
fn replay_snapshot(view: &SessionView, buffered: &HashMap<u64, (bool, Value)>) -> Value {
    let mut messages = vec![];
    let mut tools = vec![];
    for (tool, item) in buffered.values() {
        if *tool {
            tools.push(item.clone());
        } else {
            messages.push(item.clone());
        }
    }
    // Include the current window as well as records updated and evicted within this batch.
    messages.extend(view.messages.clone());
    tools.extend(view.tools.clone());
    json!({"messages":messages,"tools":tools})
}
fn checkpoint(
    view: &SessionView,
    cursor: u64,
    run: &Option<String>,
    warnings: &[String],
    fallback: usize,
) -> Value {
    json!({"cursor":cursor,"sequence":view.history_sequence,"run":run,"active":view.active,"observed":view.observed_active,"status":view.status,"warnings":warnings,"fallback":fallback,"complete":false})
}
// Runs before the Workbench publishes entries. It never restores processes or decisions.
pub(super) async fn prepare(
    store: &Store,
    mut saved: SavedSession,
) -> Result<SavedSession, String> {
    let state = store
        .history_checkpoint(&saved.id)
        .await
        .map_err(|error| error.to_string())?;
    if state
        .as_ref()
        .is_some_and(|state| state["complete"] == true)
    {
        return Ok(saved);
    }
    let base: SessionView =
        serde_json::from_value(saved.snapshot.clone()).map_err(|error| error.to_string())?;
    let mut replay = base.clone();
    replay.messages.clear();
    replay.tools.clear();
    replay.approvals.clear();
    replay.inputs.clear();
    replay.active = false;
    replay.observed_active = false;
    replay.history_sequence = 0;
    let state = state.unwrap_or_else(|| json!({}));
    let mut cursor = state["cursor"].as_u64().unwrap_or(0);
    let mut run = state["run"].as_str().map(str::to_owned);
    replay.history_sequence = state["sequence"].as_u64().unwrap_or(0);
    replay.active = state["active"] == true;
    replay.observed_active = state["observed"] == true;
    replay.status = state["status"].as_str().unwrap_or("idle").into();
    let mut warnings: Vec<String> =
        serde_json::from_value(state["warnings"].clone()).unwrap_or_default();
    let mut fallback = state["fallback"].as_u64().unwrap_or(0) as usize;
    let mut batch = 0;
    let mut buffered = HashMap::new();
    while let Some(record) = store
        .history_event(&saved.id, cursor)
        .await
        .map_err(|error| error.to_string())?
    {
        let kind = record["kind"].as_str().unwrap_or("");
        let event = &record["payload"];
        if cursor == 0 && kind != "session.created" {
            warnings.push("这段旧历史未提供创建前的完整事件；只能恢复现有日志和导出快照。".into());
        }
        if kind == "run.started" {
            if batch > 0 {
                store
                    .history_batch(
                        &saved.id,
                        &replay_snapshot(&replay, &buffered),
                        &checkpoint(&replay, cursor, &run, &warnings, fallback),
                    )
                    .await
                    .map_err(|e| e.to_string())?;
                batch = 0;
                buffered.clear();
            }
            replay.messages.clear();
            replay.tools.clear();
            run = event["runId"].as_str().map(str::to_owned);
            replay.active = true;
            replay.observed_active = false;
            if let Some(input) = base
                .runs
                .iter()
                .find(|item| Some(item.id.as_str()) == run.as_deref())
            {
                let existing = base
                    .messages
                    .iter()
                    .find(|message| message["role"] == "user" && message["runId"] == input.id);
                let pending = json!({"id":existing.and_then(|item|item["id"].as_str()).map(str::to_owned).unwrap_or_else(||format!("pending:{}",input.id)),"role":"user","runId":input.id,"text":input.text,"attachments":input.attachments,"pending":true,"reconstructedFromRun":existing.is_none()});
                let old = replay.clone();
                replay.messages.push(pending);
                stamp(&mut replay, &old, saved.revision as u64)?;
            }
        } else if kind == "agent.update" {
            restore_buffered(&mut replay, event, run.as_deref(), &buffered);
            let old = replay.clone();
            let inherited = restore(store, &mut replay, event, run.as_deref(), true).await?;
            replay.apply(event);
            annotate(
                &mut replay,
                event,
                run.as_deref(),
                inherited,
                saved.revision as u64,
            );
            stamp(&mut replay, &old, saved.revision as u64)?;
            if event["runEnded"] == true || !replay.active {
                run = None;
            }
        } else if kind == "run.ended" || kind == "run.failed" || kind == "session.recovered" {
            replay.active = false;
            replay.observed_active = false;
            run = None;
        }
        for (tool, items) in [(false, &replay.messages), (true, &replay.tools)] {
            for item in items {
                if let Some(order) = item["historyOrder"].as_u64() {
                    buffered.insert(order, (tool, item.clone()));
                }
            }
        }
        cursor = record["seq"].as_u64().unwrap_or(cursor);
        batch += 1;
        if batch >= 32 {
            store
                .history_batch(
                    &saved.id,
                    &replay_snapshot(&replay, &buffered),
                    &checkpoint(&replay, cursor, &run, &warnings, fallback),
                )
                .await
                .map_err(|e| e.to_string())?;
            batch = 0;
            buffered.clear();
        }
    }
    store
        .history_batch(
            &saved.id,
            &replay_snapshot(&replay, &buffered),
            &checkpoint(&replay, cursor, &run, &warnings, fallback),
        )
        .await
        .map_err(|e| e.to_string())?;
    replay.messages.clear();
    replay.tools.clear();
    buffered.clear();
    let mut leftovers: Vec<(&str, Value)> = base
        .messages
        .iter()
        .map(|item| ("message", item.clone()))
        .chain(base.tools.iter().map(|item| ("tool", item.clone())))
        .collect();
    leftovers.sort_by_key(|(_, item)| item["activityOrder"].as_u64().unwrap_or(0));
    for (index, (kind, mut item)) in leftovers.into_iter().enumerate().skip(fallback) {
        let role = if kind == "message" {
            item["role"].as_str().unwrap_or("unknown")
        } else {
            ""
        }
        .to_owned();
        let key = if kind == "message" {
            "id"
        } else {
            "toolCallId"
        };
        if !item[key].is_string() {
            item[key] = json!(format!("legacy-{index}"));
        }
        if kind == "message" && !item["role"].is_string() {
            item["role"] = json!("unknown");
        }
        let found = store
            .history_record(
                &saved.id,
                kind,
                item[key].as_str().unwrap_or_default(),
                &role,
                item["runId"].as_str(),
            )
            .await
            .map_err(|e| e.to_string())?;
        if let Some(mut found) = found {
            for field in ["attachments", "pending", "delivery"] {
                if let Some(value) = item.get(field) {
                    found[field] = value.clone();
                }
            }
            item = found;
        } else {
            item.as_object_mut()
                .expect("record object")
                .remove("historyOrder");
            item.as_object_mut()
                .expect("record object")
                .remove("historyRevision");
            if warnings.is_empty() {
                warnings
                    .push("部分旧记录只有最终快照；未保存的更早内容无法由当前数据验证。".into());
            }
        }
        if kind == "message" {
            replay.messages.push(item);
        } else {
            replay.tools.push(item);
        }
        let old = replay.clone(); // Existing archive versions are retained; new leftovers receive an order.
        stamp(&mut replay, &old, saved.revision as u64)?;
        fallback = index + 1;
        if fallback.is_multiple_of(32) {
            store
                .history_batch(
                    &saved.id,
                    &replay_snapshot(&replay, &buffered),
                    &checkpoint(&replay, cursor, &run, &warnings, fallback),
                )
                .await
                .map_err(|e| e.to_string())?;
            replay.messages.clear();
            replay.tools.clear();
        }
    }
    store
        .history_batch(
            &saved.id,
            &replay_snapshot(&replay, &buffered),
            &checkpoint(&replay, cursor, &run, &warnings, fallback),
        )
        .await
        .map_err(|e| e.to_string())?;
    let mut final_view = base;
    final_view.messages = store
        .history_latest(&saved.id, "message")
        .await
        .map_err(|e| e.to_string())?;
    final_view.tools = store
        .history_latest(&saved.id, "tool")
        .await
        .map_err(|e| e.to_string())?;
    for item in &mut final_view.messages {
        if item["pending"] == true
            && let Some(run) = final_view.runs.iter().find(|run| item["runId"] == run.id)
            && matches!(
                Some(run.status.as_str()),
                Some("completed" | "cancelled" | "failed" | "interrupted")
            )
        {
            item["pending"] = json!(false);
            item["delivery"] = json!(match Some(run.status.as_str()) {
                Some("completed") => "accepted",
                Some("interrupted") => "interrupted",
                _ => "unconfirmed",
            });
            item["historyRevision"] = json!(saved.revision);
        }
    }
    final_view.history_sequence = replay.history_sequence;
    saved.snapshot = serde_json::to_value(&final_view).map_err(|e| e.to_string())?;
    let mut complete = checkpoint(&replay, cursor, &run, &warnings, fallback);
    complete["complete"] = json!(true);
    store
        .history_finish(&saved, &complete)
        .await
        .map_err(|e| e.to_string())?;
    Ok(saved)
}

impl Workbench {
    pub async fn history_page(
        &self,
        id: &str,
        before: Option<u64>,
        limit: u16,
    ) -> Result<Value, String> {
        self.entry(id)?;
        self.store
            .history_page(id, before, limit)
            .await
            .map_err(|error| error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn legacy_replay_resumes_from_a_durable_checkpoint_without_replaying_execution() {
        let directory = tempfile::tempdir().unwrap();
        let store = Store::open(directory.path()).await.unwrap();
        let mut view:SessionView=serde_json::from_value(json!({"id":"legacy-history","title":"Legacy","workspace":"/legacy-history","provider":"demo","status":"idle","messages":[],"tools":[],"approvals":[],"error":null,"stopReason":null,"lastActivityAt":12345,"runs":[{"id":"old-run","text":"old input","status":"completed"}]})).unwrap();
        let mut revision = 1;
        async fn save(store: &Store, view: &SessionView, revision: i64, kind: &str, event: Value) {
            store
                .save(
                    &SavedSession {
                        id: view.id.clone(),
                        workspace: view.workspace.clone(),
                        revision,
                        snapshot: serde_json::to_value(view).unwrap(),
                    },
                    kind,
                    &event,
                )
                .await
                .unwrap();
        }
        save(&store, &view, revision, "session.created", json!({})).await;
        // Emulate data written before the history migration: snapshots and raw events only.
        store
            .history_batch(&view.id, &json!({}), &json!({"complete":false}))
            .await
            .unwrap();
        revision += 1;
        save(
            &store,
            &view,
            revision,
            "run.started",
            json!({"runId":"old-run"}),
        )
        .await;
        let events=std::iter::once(json!({"sessionUpdate":"user_message","messageId":"u","content":[{"type":"text","text":"old input"}]}))
   .chain((0..220).map(|index|json!({"sessionUpdate":"agent_message","messageId":format!("m-{index}"),"content":[{"type":"text","text":format!("prefix-{index}")}]})))
   .chain((0..140).map(|index|json!({"sessionUpdate":"tool_call_update","toolCallId":format!("t-{index}"),"status":"completed","title":format!("tool-{index}")})))
   .chain([json!({"sessionUpdate":"agent_message_chunk","messageId":"m-0","content":{"type":"text","text":"-tail"}}),json!({"sessionUpdate":"agent_thought","messageId":"m-0","content":[{"type":"text","text":"separate thought"}]}),json!({"sessionUpdate":"agent_message_chunk","messageId":"m-0","content":{"type":"text","text":"-tail2"}})]);
        for update in events {
            let event = json!({"type":"update","notification":{"update":update}});
            view.apply(&event);
            for item in view.messages.iter_mut().chain(&mut view.tools) {
                item["runId"] = json!("old-run");
            }
            revision += 1;
            save(&store, &view, revision, "agent.update", event).await;
        }
        revision += 1;
        save(&store, &view, revision, "run.ended", json!({})).await;
        let cursor = store.cursor().await.unwrap();
        let saved = store.sessions().await.unwrap().pop().unwrap();
        let migration_store = store.clone();
        let migration = tokio::spawn(async move { prepare(&migration_store, saved).await });
        let mut observed = false;
        for _ in 0..1000 {
            if store
                .history_checkpoint(&view.id)
                .await
                .unwrap()
                .is_some_and(|state| {
                    state["cursor"].as_u64().unwrap_or(0) > 0 && state["complete"] != true
                })
            {
                observed = true;
                break;
            }
            tokio::task::yield_now().await;
        }
        assert!(
            observed,
            "migration must expose a durable in-progress checkpoint"
        );
        migration.abort();
        let _ = migration.await;
        store.close().await;
        let store = Store::open(directory.path()).await.unwrap();
        let saved = store.sessions().await.unwrap().pop().unwrap();
        let restored = prepare(&store, saved).await.unwrap();
        assert_eq!(restored.revision, revision);
        assert_eq!(restored.snapshot["lastActivityAt"], 12345);
        assert_eq!(store.cursor().await.unwrap(), cursor);
        assert!(restored.snapshot["messages"].as_array().unwrap().len() <= 128);
        assert!(restored.snapshot["tools"].as_array().unwrap().len() <= 100);
        let mut records = vec![];
        let mut before = None;
        loop {
            let page = store.history_page(&view.id, before, 100).await.unwrap();
            records.extend(page["records"].as_array().unwrap().clone());
            if page["hasMore"] != true {
                break;
            }
            before = page["nextBefore"].as_u64();
        }
        assert_eq!(records.len(), 362);
        assert_eq!(
            records
                .iter()
                .filter(|record| record["item"]["role"] == "user")
                .count(),
            1
        );
        assert_eq!(
            records
                .iter()
                .find(
                    |record| record["item"]["id"] == "m-0" && record["item"]["role"] == "assistant"
                )
                .unwrap()["item"]["text"],
            "prefix-0-tail-tail2"
        );
        assert_eq!(
            records
                .iter()
                .find(|record| record["item"]["id"] == "m-0" && record["item"]["role"] == "thought")
                .unwrap()["item"]["text"],
            "separate thought"
        );
        assert!(store.history_checkpoint(&view.id).await.unwrap().unwrap()["complete"] == true);
        store.close().await;
    }
    #[tokio::test]
    async fn snapshot_only_import_does_not_trust_foreign_orders_or_invent_missing_roles() {
        let directory = tempfile::tempdir().unwrap();
        let store = Store::open(directory.path()).await.unwrap();
        let snapshot = json!({"id":"snapshot-only","title":"Imported","workspace":"/legacy","provider":"demo","status":"interrupted","messages":[{"text":"old text","historyOrder":99999}],"tools":[{"toolCallId":"tool","historyOrder":99999}],"approvals":[],"error":null,"stopReason":null,"lastActivityAt":77});
        let saved = SavedSession {
            id: "snapshot-only".into(),
            workspace: "/legacy".into(),
            revision: 1,
            snapshot,
        };
        store
            .save(&saved, "session.imported", &json!({}))
            .await
            .unwrap();
        let restored = prepare(&store, saved).await.unwrap();
        let page = store
            .history_page("snapshot-only", None, 128)
            .await
            .unwrap();
        assert_eq!(page["records"].as_array().unwrap().len(), 2);
        assert_eq!(page["records"][0]["item"]["role"], "unknown");
        assert_eq!(page["records"][0]["item"]["text"], "old text");
        assert_eq!(page["records"][0]["item"]["historyOrder"], 1);
        assert_eq!(page["records"][1]["item"]["historyOrder"], 2);
        assert!(!page["warnings"].as_array().unwrap().is_empty());
        assert_eq!(restored.snapshot["lastActivityAt"], 77);
        assert_eq!(restored.revision, 1);
        assert_eq!(restored.snapshot["status"], "interrupted");
        store.close().await;
    }
}
