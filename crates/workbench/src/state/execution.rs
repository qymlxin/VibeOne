use super::*;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use vibeone_agent_client::event_sink;

pub(crate) fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn finish(view: &mut SessionView, status: &str) {
    if let Some(run) = view.runs.iter_mut().rev().find(|run| {
        matches!(
            run["status"].as_str(),
            Some("starting" | "running" | "requires_action" | "cancelling")
        )
    }) {
        run["status"] = json!(status);
        run["finishedAt"] = json!(now());
        run["error"] = json!(view.error);
    }
}
// Git worktrees have independent roots. Nested directories in the same worktree share a lease.
async fn lease_key(path: &str) -> Result<String, String> {
    let path = PathBuf::from(path)
        .canonicalize()
        .map_err(|_| "工作区已移动或删除")?;
    let output = tokio::process::Command::new("git")
        .args([
            "-C",
            path.to_str().ok_or("工作区路径无效")?,
            "rev-parse",
            "--show-toplevel",
        ])
        .kill_on_drop(true)
        .output();
    let root = match tokio::time::timeout(Duration::from_secs(3), output).await {
        Ok(Ok(output)) if output.status.success() => {
            PathBuf::from(String::from_utf8_lossy(&output.stdout).trim())
        }
        _ => path,
    };
    Ok(root.to_string_lossy().into_owned())
}

impl Workbench {
    fn driver(self: &Arc<Self>, entry: Arc<Entry>) {
        if entry.driver.swap(true, Ordering::SeqCst) {
            entry.wake.notify_one();
            return;
        }
        let workbench = self.clone();
        tokio::spawn(async move {
            loop {
                if workbench.stopping.load(Ordering::SeqCst) {
                    break;
                }
                let ready = {
                    let view = entry.view.lock().expect("view poisoned");
                    !view.active
                        && !view.queue_paused
                        && !view.queue.is_empty()
                        && !view.archived
                        && !view.history_only
                };
                if !ready {
                    entry.wake.notified().await;
                    continue;
                }
                if let Err(error) = workbench.run_next(&entry).await {
                    let _gate = entry.gate.lock().await;
                    let mut view = entry.view.lock().expect("view poisoned").clone();
                    view.active = false;
                    view.status = "error".into();
                    view.error = Some(error);
                    view.queue_paused = true;
                    view.approvals.clear();
                    finish(&mut view, "failed");
                    let _ = workbench
                        .commit(&entry, view, "run.failed", &json!({}))
                        .await;
                }
            }
            entry.driver.store(false, Ordering::SeqCst);
        });
    }

    pub async fn submit(
        self: &Arc<Self>,
        id: &str,
        text: String,
        key: Option<String>,
    ) -> Result<Value, String> {
        self.available()?;
        if text.trim().is_empty() || text.len() > 32_768 {
            return Err("输入不能为空且不能超过 32 KiB".into());
        }
        if key
            .as_ref()
            .is_some_and(|key| key.is_empty() || key.len() > 128)
        {
            return Err("无效的幂等键".into());
        }
        let entry = self.entry(id)?;
        let _gate = entry.gate.lock().await;
        self.available()?;
        let mut view = entry.view.lock().expect("view poisoned").clone();
        if let Some(key) = &key
            && let Some(run) = view.runs.iter().find(|run| run["key"] == *key)
        {
            if run["text"] != text {
                return Err("同一幂等键不能用于不同输入".into());
            }
            return Ok(
                json!({"operationId":run["id"],"queued":run["status"]=="queued","duplicate":true}),
            );
        }
        if view.archived || view.history_only || view.status == "disconnected" {
            return Err("此会话不能执行，请取消归档或新建会话".into());
        }
        if view.queue.len() >= 20 || view.runs.len() >= 1000 {
            return Err("队列或会话执行数量已达到上限，请撤回消息或新建会话".into());
        }
        if !view.active && view.queue.is_empty() {
            view.queue_paused = false;
        }
        let lease = lease_key(&view.workspace).await?;
        {
            let mut leases = self.leases.lock().expect("leases poisoned");
            if leases.get(&lease).is_some_and(|owner| owner != id) {
                return Err(
                    "同一工作区正在其他会话中执行，请先停止该会话或使用独立 Worktree".into(),
                );
            }
            if !view.active && !view.queue_paused {
                leases.insert(lease.clone(), id.into());
            }
        }
        let run_id = uuid::Uuid::new_v4().to_string();
        let queued = view.active || view.queue_paused || !view.queue.is_empty();
        let run = json!({"id":run_id,"text":text,"key":key,"status":"queued","createdAt":now()});
        view.queue.push(run.clone());
        view.runs.push(run);
        if view.title == "新会话" {
            view.title = text.chars().take(28).collect();
        }
        if let Err(error) = self
            .commit(&entry, view, "run.queued", &json!({"runId":run_id}))
            .await
        {
            if !queued {
                self.leases.lock().expect("leases poisoned").remove(&lease);
            }
            return Err(error);
        }
        self.driver(entry.clone());
        Ok(json!({"operationId":run_id,"queued":queued,"duplicate":false}))
    }

    async fn run_next(self: &Arc<Self>, entry: &Arc<Entry>) -> Result<(), String> {
        let (text, lease, mut cancelled) = {
            let _gate = entry.gate.lock().await;
            self.available()?;
            let mut view = entry.view.lock().expect("view poisoned").clone();
            if view.active
                || view.queue_paused
                || view.queue.is_empty()
                || view.archived
                || view.history_only
            {
                return Ok(());
            }
            let lease = lease_key(&view.workspace).await?;
            {
                let mut leases = self.leases.lock().expect("leases poisoned");
                if leases.get(&lease).is_some_and(|owner| *owner != view.id) {
                    return Err("工作区正被另一会话使用，队列已暂停".into());
                }
                leases.insert(lease.clone(), view.id.clone());
            }
            let queued = view.queue.remove(0);
            let text = queued["text"].as_str().unwrap_or_default().to_owned();
            view.active = true;
            view.observed_active = false;
            view.status = "starting".into();
            view.error = None;
            view.stop_reason = None;
            let run = view
                .runs
                .iter_mut()
                .find(|run| run["id"] == queued["id"])
                .ok_or("队列数据无效")?;
            run["status"] = json!("starting");
            run["startedAt"] = json!(now());
            view.messages.push(json!({"id":uuid::Uuid::new_v4().to_string(),"runId":queued["id"],"role":"user","text":text,"pending":true}));
            let (cancel, cancelled) = watch::channel(false);
            if let Err(error) = self
                .commit(entry, view, "run.started", &json!({"runId":queued["id"]}))
                .await
            {
                self.leases.lock().expect("leases poisoned").remove(&lease);
                return Err(error);
            }
            *entry.cancel.lock().expect("cancel poisoned") = Some(cancel);
            (text, lease, cancelled)
        };
        let result = self.execute(entry, &text, &mut cancelled).await;
        self.leases.lock().expect("leases poisoned").remove(&lease);
        if let Err(error) = result {
            entry.generation.fetch_add(1, Ordering::SeqCst);
            entry.connection.lock().expect("connection poisoned").take();
            let _gate = entry.gate.lock().await;
            if self.stopping.load(Ordering::SeqCst) {
                return Ok(());
            }
            let mut view = entry.view.lock().expect("view poisoned").clone();
            view.active = false;
            view.approvals.clear();
            view.queue_paused = true;
            if *cancelled.borrow() {
                view.status = "idle".into();
                view.stop_reason = Some("cancelled".into());
                finish(&mut view, "cancelled");
            } else {
                view.status = "error".into();
                view.error = Some(error.chars().take(4000).collect());
                finish(&mut view, "failed");
            }
            self.commit(entry, view, "run.ended", &json!({})).await?;
        }
        Ok(())
    }

    async fn execute(
        self: &Arc<Self>,
        entry: &Arc<Entry>,
        text: &str,
        cancelled: &mut watch::Receiver<bool>,
    ) -> Result<(), String> {
        let existing = entry
            .connection
            .lock()
            .expect("connection poisoned")
            .clone();
        let connection = if let Some(connection) = existing {
            connection
        } else {
            let (provider, workspace) = {
                let view = entry.view.lock().expect("view poisoned");
                (view.provider.clone(), view.workspace.clone())
            };
            let descriptor = self
                .providers
                .iter()
                .find(|item| item.id == provider)
                .cloned()
                .ok_or("Agent Provider 不可用")?;
            let generation = entry.generation.fetch_add(1, Ordering::SeqCst) + 1;
            let weak = Arc::downgrade(entry);
            let parent = Arc::downgrade(self);
            let sink = event_sink(move |event| {
                let weak = weak.clone();
                let parent = parent.clone();
                async move {
                    if let (Some(entry), Some(workbench)) = (weak.upgrade(), parent.upgrade()) {
                        workbench.apply_event(&entry, generation, event).await
                    } else {
                        Ok(())
                    }
                }
            });
            tokio::select! {
                result = AgentSession::connect(descriptor.command, descriptor.args, PathBuf::from(workspace), sink) => Arc::new(result?),
                _ = cancelled.changed() => return Err("启动已取消".into()),
            }
        };
        *entry.connection.lock().expect("connection poisoned") = Some(connection.clone());
        if *cancelled.borrow() || self.available().is_err() {
            let _ = connection.cancel();
            return Err("执行已取消".into());
        }
        connection.prompt(text).await?;
        loop {
            let notified = entry.wake.notified();
            if !entry.view.lock().expect("view poisoned").active {
                break;
            }
            if self.stopping.load(Ordering::SeqCst) {
                return Ok(());
            }
            if *cancelled.borrow() {
                let _ = connection.cancel();
                tokio::time::timeout(Duration::from_secs(5), async {
                    loop {
                        let wake = entry.wake.notified();
                        if !entry.view.lock().expect("view poisoned").active {
                            break;
                        }
                        wake.await;
                    }
                })
                .await
                .map_err(|_| "停止宽限期已到，正在关闭 Agent 连接".to_owned())?;
                break;
            }
            tokio::select! { _ = notified => {}, _ = cancelled.changed() => {} }
        }
        Ok(())
    }

    async fn apply_event(
        &self,
        entry: &Entry,
        generation: u64,
        event: Value,
    ) -> Result<(), String> {
        let _gate = entry.gate.lock().await;
        if self.stopping.load(Ordering::SeqCst)
            || entry.generation.load(Ordering::SeqCst) != generation
        {
            return Ok(());
        }
        let mut view = entry.view.lock().expect("view poisoned").clone();
        let was_active = view.active;
        view.apply(&event);
        if was_active && !view.active {
            let status = match view.stop_reason.as_deref() {
                Some("end_turn") => "completed",
                Some("cancelled") => "cancelled",
                _ => "failed",
            };
            if status != "completed" {
                view.queue_paused = true;
            }
            finish(&mut view, status);
        } else if view.active
            && let Some(run) = view
                .runs
                .iter_mut()
                .rev()
                .find(|run| run["status"] != "queued" && run["finishedAt"].is_null())
        {
            run["status"] = json!(view.status);
        }
        if event["type"] == "permission_resolved" {
            if let Some(decision) = view
                .decisions
                .iter_mut()
                .find(|item| item["requestId"] == event["id"])
            {
                decision["delivery"] = json!(if event["selected"] == decision["option"] {
                    "sent"
                } else {
                    "uncertain"
                });
            }
        }
        self.commit(entry, view, "agent.update", &event).await?;
        entry.wake.notify_one();
        Ok(())
    }

    pub async fn cancel(&self, id: &str) -> Result<(), String> {
        self.available()?;
        let entry = self.entry(id)?;
        let _gate = entry.gate.lock().await;
        let mut view = entry.view.lock().expect("view poisoned").clone();
        view.queue_paused = true;
        if view.active {
            view.status = "cancelling".into();
        }
        self.commit(&entry, view, "run.cancel_requested", &json!({}))
            .await?;
        if let Some(cancel) = entry.cancel.lock().expect("cancel poisoned").as_ref() {
            let _ = cancel.send(true);
        }
        if let Some(connection) = entry
            .connection
            .lock()
            .expect("connection poisoned")
            .as_ref()
        {
            connection.cancel()?;
        }
        entry.wake.notify_one();
        Ok(())
    }

    pub async fn queue_action(
        self: &Arc<Self>,
        id: &str,
        withdraw: Option<String>,
        resume: bool,
        fresh_context: bool,
    ) -> Result<(), String> {
        self.available()?;
        let entry = self.entry(id)?;
        let _gate = entry.gate.lock().await;
        let mut view = entry.view.lock().expect("view poisoned").clone();
        if let Some(withdraw) = withdraw {
            let position = view
                .queue
                .iter()
                .position(|run| run["id"] == withdraw)
                .ok_or("消息已开始执行或已撤回")?;
            view.queue.remove(position);
            if let Some(run) = view.runs.iter_mut().find(|run| run["id"] == withdraw) {
                run["status"] = json!("withdrawn");
                run["finishedAt"] = json!(now());
            }
        }
        if resume {
            if view.active || view.archived {
                return Err("当前会话不能恢复队列".into());
            }
            if view.history_only && !fresh_context {
                return Err("重启后需要明确同意在新 Agent 上下文中执行队列".into());
            }
            if fresh_context {
                view.history_only = false;
                view.status = "idle".into();
                view.error = None;
            }
            view.queue_paused = false;
        }
        self.commit(&entry, view, "queue.updated", &json!({"resume":resume}))
            .await?;
        self.driver(entry.clone());
        Ok(())
    }
}
