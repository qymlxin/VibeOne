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
    for message in &mut view.messages {
        if message["pending"] == true {
            message["pending"] = json!(false);
            message["delivery"] = json!(if status == "completed" {
                "accepted"
            } else {
                "unconfirmed"
            });
        }
    }
    if let Some(run) = view.runs.iter_mut().rev().find(|run| {
        matches!(
            Some(run.status.as_str()),
            Some("starting" | "running" | "requires_action" | "cancelling")
        )
    }) {
        run.status = status.into();
        run.finished_at = Some(now());
        run.error = view.error.clone();
        if status == "cancelled" {
            for tool in &mut view.tools {
                if tool["runId"] == run.id
                    && matches!(tool["status"].as_str(), Some("pending" | "in_progress"))
                {
                    tool["status"] = json!("cancelled");
                }
            }
        }
    }
}
// Git worktrees have independent roots. Nested directories in the same worktree share a lease.
async fn lease_key(path: &str) -> Result<String, String> {
    let path = PathBuf::from(path)
        .canonicalize()
        .map_err(|_| "工作区已移动或删除")?;
    let output = crate::files::git_command(&path)
        .args(["rev-parse", "--show-toplevel"])
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
                if workbench.available().is_err() {
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
                    workbench
                        .leases
                        .lock()
                        .expect("leases poisoned")
                        .retain(|_, owner| *owner != view.id);
                    view.active = false;
                    view.status = "error".into();
                    view.error = Some(error);
                    view.queue_paused = true;
                    view.approvals.clear();
                    view.inputs.clear();
                    finish(&mut view, "failed");
                    let _ = workbench
                        .commit(&entry, view, "run.failed", &json!({}))
                        .await;
                }
            }
            entry.driver.store(false, Ordering::SeqCst);
        });
    }

    pub(crate) async fn submit(
        self: &Arc<Self>,
        id: &str,
        text: String,
        key: Option<String>,
        files: Vec<String>,
        attachment_ids: Vec<String>,
    ) -> Result<crate::contracts::SubmitMessageReceipt, DomainError> {
        self.command_available()?;
        if (text.trim().is_empty() && attachment_ids.is_empty() && files.is_empty())
            || text.len() > 32_768
        {
            return Err(DomainError::new(
                ErrorKind::InvalidInput,
                "输入不能为空且不能超过 32 KiB",
            ));
        }
        if key
            .as_ref()
            .is_some_and(|key| key.is_empty() || key.len() > 128)
        {
            return Err(DomainError::new(ErrorKind::InvalidInput, "无效的幂等键"));
        }
        let entry = self.command_entry(id)?;
        let _gate = entry.gate.lock().await;
        self.command_available()?;
        if entry.configuring.load(Ordering::SeqCst) {
            return Err(DomainError::new(
                ErrorKind::ConfigurationBusy,
                "Agent 配置正在更新，请稍后发送",
            ));
        }
        let mut view = entry.view.lock().expect("view poisoned").clone();
        if let Some(key) = &key
            && let Some(run) = view
                .runs
                .iter()
                .find(|run| run.key.as_deref() == Some(key.as_str()))
        {
            if run.text != text || run.files != files || run.attachment_ids != attachment_ids {
                return Err(DomainError::new(
                    ErrorKind::IdempotencyConflict,
                    "同一幂等键不能用于不同输入",
                ));
            }
            return Ok(crate::contracts::SubmitMessageReceipt {
                operation_id: run.id.clone(),
                queued: run.status == "queued",
                duplicate: true,
            });
        }
        let needs_lease = entry
            .provider_lease
            .lock()
            .expect("provider lease poisoned")
            .is_none();
        if let Some((plugin_id, _)) = view.provider.split_once(':')
            && needs_lease
        {
            let lease = self.plugins.acquire(plugin_id).map_err(|_| {
                DomainError::new(
                    ErrorKind::ProviderUnavailable,
                    "Provider 插件不可用，请检查插件状态",
                )
            })?;
            if view
                .profile
                .as_ref()
                .and_then(|profile| profile.details.generation)
                != Some(lease.key().generation)
            {
                return Err(DomainError::new(
                    ErrorKind::ProviderConflict,
                    "Provider 代次已更新，请新建会话",
                ));
            }
            *entry
                .provider_lease
                .lock()
                .expect("provider lease poisoned") = Some(lease);
        }
        if view.archived || view.history_only || view.status == "disconnected" {
            return Err(DomainError::new(
                ErrorKind::SessionUnavailable,
                "此会话不能执行，请取消归档或新建会话",
            ));
        }
        if view.queue.len() >= 20 || view.runs.len() >= 1000 {
            return Err(DomainError::new(
                ErrorKind::RunLimit,
                "队列或会话执行数量已达到上限，请撤回消息或新建会话",
            ));
        }
        if !view.active && view.queue.is_empty() {
            view.queue_paused = false;
        }
        if files.len() > 5 {
            return Err(DomainError::new(
                ErrorKind::InvalidReference,
                "每轮最多引用 5 个文件或文件夹",
            ));
        }
        for path in &files {
            crate::files::reference(&view.workspace, path)
                .await
                .map_err(|error| DomainError::new(ErrorKind::InvalidReference, error))?;
        }
        let attachments = self.attachment_metadata(id, &attachment_ids).await?;
        if view.agent_state["capabilities"].is_object() {
            self.attachment_blocks(id, &attachment_ids, &view.agent_state["capabilities"])
                .await?;
        }
        let lease = lease_key(&view.workspace)
            .await
            .map_err(|_| DomainError::new(ErrorKind::WorkspaceNotFound, "工作区已移动或删除"))?;
        {
            let mut leases = self.leases.lock().expect("leases poisoned");
            if leases.get(&lease).is_some_and(|owner| owner != id) {
                return Err(DomainError::new(
                    ErrorKind::WorkspaceBusy,
                    "同一工作区正在其他会话中执行，请先停止该会话或使用独立 Worktree",
                ));
            }
            if !view.active && !view.queue_paused {
                leases.insert(lease.clone(), id.into());
            }
        }
        let run_id = uuid::Uuid::new_v4().to_string();
        let queued = view.active || view.queue_paused || !view.queue.is_empty();
        let run = crate::contracts::RunRecord {
            id: run_id.clone(),
            text: text.clone(),
            key,
            files,
            attachment_ids,
            attachments,
            status: "queued".into(),
            created_at: Some(now()),
            started_at: None,
            finished_at: None,
            error: None,
            extensions: Default::default(),
        };
        view.queue.push(run.clone());
        view.runs.push(run);
        if view.title == "新会话" {
            view.title = if text.trim().is_empty() {
                "附件任务".into()
            } else {
                text.chars().take(28).collect()
            };
        }
        if let Err(_error) = self
            .commit(&entry, view, "run.queued", &json!({"runId":run_id}))
            .await
        {
            if !queued {
                self.leases.lock().expect("leases poisoned").remove(&lease);
            }
            return Err(DomainError::storage());
        }
        self.driver(entry.clone());
        Ok(crate::contracts::SubmitMessageReceipt {
            operation_id: run_id,
            queued,
            duplicate: false,
        })
    }

    async fn run_next(self: &Arc<Self>, entry: &Arc<Entry>) -> Result<(), String> {
        let (text, attachment_ids, lease, mut cancelled) = {
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
            let mut text = queued.text.clone();
            let attachment_ids = queued.attachment_ids.clone();
            self.attachment_metadata(&view.id, &attachment_ids)
                .await
                .map_err(|error| error.to_string())?;
            for path in &queued.files {
                let context = crate::files::reference(&view.workspace, path)
                    .await
                    .map_err(|error| {
                        format!("引用内容无法读取，队列已暂停，请重新提交：{error}")
                    })?;
                text.push_str("\n\n");
                text.push_str(&context);
            }
            view.active = true;
            view.observed_active = false;
            view.status = "starting".into();
            view.error = None;
            view.stop_reason = None;
            let run = view
                .runs
                .iter_mut()
                .find(|run| run.id == queued.id)
                .ok_or("队列数据无效")?;
            run.status = "starting".into();
            run.started_at = Some(now());
            if view.messages.len() >= 128 {
                view.messages.remove(0);
            }
            view.messages.push(json!({"id":uuid::Uuid::new_v4().to_string(),"runId":queued.id,"role":"user","text":text,"attachments":queued.attachments,"pending":true}));
            let (cancel, cancelled) = watch::channel(false);
            if let Err(error) = self
                .commit(entry, view, "run.started", &json!({"runId":queued.id}))
                .await
            {
                self.leases.lock().expect("leases poisoned").remove(&lease);
                return Err(error);
            }
            *entry.cancel.lock().expect("cancel poisoned") = Some(cancel);
            (text, attachment_ids, lease, cancelled)
        };
        let result = self
            .execute(entry, &text, &attachment_ids, &mut cancelled)
            .await;
        // An upstream idle/cancelled notification does not prove its tool
        // descendants have exited. Retire the connection on every stop.
        let result = if *cancelled.borrow() {
            Err("执行已取消".to_owned())
        } else {
            result
        };
        if let Err(error) = result {
            entry.generation.fetch_add(1, Ordering::SeqCst);
            let connection = entry.connection.lock().expect("connection poisoned").take();
            if let Some(connection) = connection {
                connection.shutdown().await;
            }
            let _gate = entry.gate.lock().await;
            if self.stopping.load(Ordering::SeqCst) {
                return Ok(());
            }
            let mut view = entry.view.lock().expect("view poisoned").clone();
            view.active = false;
            view.approvals.clear();
            view.inputs.clear();
            view.queue_paused = true;
            if view.agent_state["contextRestoreState"] == "restoring" {
                view.agent_state["contextRestoreState"] = json!("failed");
                view.history_only = true;
            }
            if *cancelled.borrow() {
                view.status = "idle".into();
                view.stop_reason = Some("cancelled".into());
                if view.agent_state["reconnectConfigOptions"].is_null() {
                    view.agent_state["reconnectConfigOptions"] =
                        view.agent_state["configOptions"].clone();
                }
                view.agent_state["contextRestartedAt"] = json!(now());
                finish(&mut view, "cancelled");
            } else {
                view.status = "error".into();
                view.error = Some(error.chars().take(4000).collect());
                finish(&mut view, "failed");
            }
            self.commit(entry, view, "run.ended", &json!({})).await?;
        }
        self.leases.lock().expect("leases poisoned").remove(&lease);
        Ok(())
    }

    async fn execute(
        self: &Arc<Self>,
        entry: &Arc<Entry>,
        text: &str,
        attachment_ids: &[String],
        cancelled: &mut watch::Receiver<bool>,
    ) -> Result<(), String> {
        let resume_id = entry.view.lock().expect("view poisoned").agent_state["resumeSessionId"]
            .as_str()
            .map(str::to_owned);
        if resume_id.is_some()
            && entry
                .connection
                .lock()
                .expect("connection poisoned")
                .is_none()
        {
            let _gate = entry.gate.lock().await;
            let mut view = entry.view.lock().expect("view poisoned").clone();
            view.agent_state["contextRestoreState"] = json!("restoring");
            self.commit(entry, view, "session.context_connecting", &json!({}))
                .await?;
        }
        let restore_options =
            entry.view.lock().expect("view poisoned").agent_state["reconnectConfigOptions"]
                .as_array()
                .cloned();
        let existing = entry
            .connection
            .lock()
            .expect("connection poisoned")
            .clone();
        let connection = if let Some(connection) = existing {
            connection
        } else {
            let (provider, workspace, profile) = {
                let view = entry.view.lock().expect("view poisoned");
                (
                    view.provider.clone(),
                    view.workspace.clone(),
                    view.profile.clone(),
                )
            };
            let mut descriptor = self
                .provider_descriptors()
                .into_iter()
                .find(|item| item.id == provider)
                .or_else(|| {
                    profile
                        .as_ref()
                        .filter(|profile| profile.details.command.is_some())
                        .map(|profile| Provider {
                            id: provider.clone(),
                            name: provider.clone(),
                            description: String::new(),
                            available: true,
                            command: PathBuf::from(
                                profile.details.command.as_deref().unwrap_or_default(),
                            ),
                            args: vec![],
                        })
                })
                .ok_or("Agent Provider 不可用")?;
            if let Some(profile) = profile {
                if let Some(command) = profile
                    .details
                    .command
                    .as_deref()
                    .filter(|command| !command.is_empty())
                {
                    descriptor.command = PathBuf::from(command);
                    descriptor.args = vec![];
                }
                if let Some(args) = profile.details.args {
                    descriptor.args = args;
                }
            }
            let interactions = Arc::new(AgentInteractions::default());
            *entry.interactions.lock().expect("interactions poisoned") = Some(interactions.clone());
            let generation = entry.generation.fetch_add(1, Ordering::SeqCst) + 1;
            let connection_id = uuid::Uuid::new_v4().to_string();
            let weak = Arc::downgrade(entry);
            let parent = Arc::downgrade(self);
            let sink = event_sink(move |event| {
                let weak = weak.clone();
                let parent = parent.clone();
                let connection_id = connection_id.clone();
                async move {
                    if let (Some(entry), Some(workbench)) = (weak.upgrade(), parent.upgrade()) {
                        workbench
                            .apply_event(&entry, generation, &connection_id, event)
                            .await
                    } else {
                        Ok(())
                    }
                }
            });
            tokio::select! {
                result = async {
                    if let Some(id)=resume_id.clone() {
                        AgentSession::resume_with_interactions(descriptor.command,descriptor.args,PathBuf::from(workspace),id,sink,interactions).await
                    }else{AgentSession::connect_with_interactions(descriptor.command,descriptor.args,PathBuf::from(workspace),sink,interactions).await}
                } => Arc::new(result?),
                _ = cancelled.changed() => return Err("启动已取消".into()),
            }
        };
        *entry.connection.lock().expect("connection poisoned") = Some(connection.clone());
        if let Some(options) = restore_options {
            let mut restored = None;
            for option in options {
                let config_id = option["configId"].as_str().ok_or("上次 Agent 配置无效")?;
                let response = tokio::select! {
                    response = connection.configure(config_id, option["currentValue"].clone()) => response?,
                    _ = cancelled.changed() => return Err("恢复 Agent 配置时已停止".into()),
                };
                restored = Some(response["configOptions"].clone());
            }
            let _gate = entry.gate.lock().await;
            let mut view = entry.view.lock().expect("view poisoned").clone();
            if let Some(options) = restored {
                view.agent_state["configOptions"] = options;
            }
            view.agent_state
                .as_object_mut()
                .expect("Agent state object")
                .remove("reconnectConfigOptions");
            self.commit(entry, view, "agent.configuration_restored", &json!({}))
                .await?;
        }
        let context_connected = resume_id.is_some()
            && entry.view.lock().expect("view poisoned").agent_state["contextRestoreState"]
                == "restoring";
        if context_connected {
            let _gate = entry.gate.lock().await;
            let mut view = entry.view.lock().expect("view poisoned").clone();
            view.agent_state["contextRestoreState"] = json!("restored");
            view.agent_state["contextResumedAt"] = json!(now());
            self.commit(entry, view, "session.context_resumed", &json!({}))
                .await?;
        }
        if *cancelled.borrow() || self.available().is_err() {
            let _ = connection.cancel();
            return Err("执行已取消".into());
        }
        let (id, capabilities) = {
            let view = entry.view.lock().expect("view poisoned");
            (view.id.clone(), view.agent_state["capabilities"].clone())
        };
        let mut blocks = if text.trim().is_empty() {
            vec![]
        } else {
            vec![json!({"type":"text","text":text})]
        };
        blocks.extend(
            self.attachment_blocks(&id, attachment_ids, &capabilities)
                .await
                .map_err(|error| error.to_string())?,
        );
        tokio::select! {
            result=connection.prompt_blocks(blocks)=>{result?;},
            _=cancelled.changed()=>{let _=connection.cancel();return Err("执行已取消".into());}
        }
        loop {
            let notified = entry.wake.notified();
            if *cancelled.borrow() {
                let _ = connection.cancel();
                return Err("执行已取消，正在排空 Agent 进程".into());
            }
            if !entry.view.lock().expect("view poisoned").active {
                break;
            }
            if self.stopping.load(Ordering::SeqCst) {
                return Ok(());
            }
            tokio::select! { _ = notified => {}, _ = cancelled.changed() => {} }
        }
        Ok(())
    }

    async fn apply_event(
        &self,
        entry: &Entry,
        generation: u64,
        connection_id: &str,
        mut event: Value,
    ) -> Result<(), String> {
        let _gate = entry.gate.lock().await;
        if self.stopping.load(Ordering::SeqCst)
            || entry.generation.load(Ordering::SeqCst) != generation
        {
            return Ok(());
        }
        for field in ["messageId", "toolCallId", "terminalId"] {
            if let Some(id) = event["notification"]["update"][field].as_str() {
                event["notification"]["update"][field] = json!(format!("{connection_id}:{id}"));
            }
        }
        let mut view = entry.view.lock().expect("view poisoned").clone();
        view.agent_state["connectionId"] = json!(connection_id);
        let was_active = view.active;
        let current_run = view
            .runs
            .iter()
            .rev()
            .find(|run| {
                matches!(
                    Some(run.status.as_str()),
                    Some("starting" | "running" | "requires_action" | "cancelling")
                )
            })
            .map(|run| json!(run.id));
        let inherited = history::restore(
            &self.store,
            &mut view,
            &event,
            current_run.as_ref().and_then(Value::as_str),
            false,
        )
        .await?;
        view.apply(&event)?;
        let cancelling = entry
            .cancel
            .lock()
            .expect("cancel poisoned")
            .as_ref()
            .is_some_and(|cancel| *cancel.borrow());
        if was_active && cancelling {
            // Only run_next may publish terminal cancellation after shutdown.
            view.active = true;
            view.status = "cancelling".into();
            view.stop_reason = None;
            view.approvals.clear();
            view.inputs.clear();
        }
        history::annotate(
            &mut view,
            &event,
            current_run.as_ref().and_then(Value::as_str),
            inherited,
            (entry.revision.load(Ordering::SeqCst) + 1) as u64,
        );
        if event["type"] == "permission" || event["type"] == "input" {
            let requests = if event["type"] == "permission" {
                &mut view.approvals
            } else {
                &mut view.inputs
            };
            if let Some(request) = requests
                .iter_mut()
                .find(|request| event["id"] == request.id)
            {
                request.run_id = current_run
                    .as_ref()
                    .and_then(Value::as_str)
                    .map(str::to_owned);
                request.created_at = Some(now());
                request.expires_at = Some(now() + 600_000);
            }
        }
        if event["type"] == "update" {
            let update = &event["notification"]["update"];
            let order = entry.revision.load(Ordering::SeqCst) + 1;
            let item = if update["messageId"].is_string() {
                view.messages
                    .iter_mut()
                    .find(|item| item["id"] == update["messageId"])
            } else if update["toolCallId"].is_string() {
                view.tools
                    .iter_mut()
                    .find(|item| item["toolCallId"] == update["toolCallId"])
            } else {
                None
            };
            if let Some(item) = item {
                if item["runId"].is_null() {
                    item["runId"] = json!(current_run);
                }
                if item["activityOrder"].is_null() {
                    item["activityOrder"] = json!(order);
                }
                item["updatedOrder"] = json!(order);
            }
        }
        if event["type"] == "update"
            && event["notification"]["update"]["sessionUpdate"] == "user_message"
        {
            let metadata = view
                .runs
                .iter()
                .find(|run| Some(json!(run.id)) == current_run)
                .map(|run| json!(run.attachments))
                .unwrap_or_else(|| json!([]));
            if let Some(message) = view
                .messages
                .iter_mut()
                .find(|message| message["id"] == event["notification"]["update"]["messageId"])
            {
                message["attachments"] = metadata;
            }
        }
        if event["type"] == "disconnected" {
            for decision in &mut view.decisions {
                if decision.delivery == "pending" {
                    decision.delivery = "uncertain".into();
                }
            }
        }

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
                .find(|run| run.status != "queued" && run.finished_at.is_none())
        {
            run.status = view.status.clone();
        }
        if event["type"] == "permission_resolved"
            && let Some(decision) = view
                .decisions
                .iter_mut()
                .find(|item| event["id"] == item.request_id)
        {
            decision.delivery = if event["selected"].as_str() == decision.option.as_deref() {
                "sent"
            } else {
                "uncertain"
            }
            .into();
        }
        if event["type"] == "input_resolved"
            && let Some(decision) = view
                .decisions
                .iter_mut()
                .find(|item| event["id"] == item.request_id)
        {
            decision.delivery = if event["received"] == true {
                "sent"
            } else {
                "uncertain"
            }
            .into();
        }
        event["runEnded"] = json!(was_active && !view.active);
        self.commit(entry, view, "agent.update", &event).await?;
        entry.wake.notify_one();
        Ok(())
    }

    #[cfg(test)]
    pub(crate) async fn cancel(&self, id: &str) -> Result<(), DomainError> {
        self.cancel_with_receipt(id, None, None).await
    }
    pub(crate) async fn cancel_with_receipt(
        &self,
        id: &str,
        key: Option<&str>,
        run_id: Option<&str>,
    ) -> Result<(), DomainError> {
        self.command_available()?;
        let entry = self.command_entry(id)?;
        let _gate = entry.gate.lock().await;
        self.command_available()?;
        let mut view = entry.view.lock().expect("view poisoned").clone();
        use sha2::{Digest, Sha256};
        let hash = |value: &Value| {
            Sha256::digest(serde_json::to_vec(value).expect("JSON serializes"))
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>()
        };
        if key.is_some_and(|key| key.is_empty() || key.len() > 128)
            || run_id.is_some_and(|id| id.is_empty() || id.len() > 128)
        {
            return Err(DomainError::new(
                ErrorKind::InvalidInput,
                "停止请求身份无效",
            ));
        }
        let receipt_key = key.map(|key| hash(&json!([id, key])));
        let fingerprint = hash(&json!({"runId":run_id}));
        if let Some(key) = &receipt_key {
            let saved = self
                .catalog
                .lock()
                .expect("catalog poisoned")
                .get("stop-command")
                .and_then(|items| items.get(key))
                .cloned();
            if let Some(saved) = saved {
                if saved["fingerprint"] != fingerprint {
                    return Err(DomainError::new(
                        ErrorKind::IdempotencyConflict,
                        "同一停止幂等键的目标不同",
                    ));
                }
                return Ok(());
            }
        }
        let active_run = view
            .runs
            .iter()
            .rev()
            .find(|run| {
                run.finished_at.is_none()
                    && matches!(
                        run.status.as_str(),
                        "starting" | "running" | "requires_action" | "cancelling"
                    )
            })
            .map(|run| run.id.as_str());
        if let Some(expected) = run_id
            && (!view.active || active_run != Some(expected))
        {
            return Err(DomainError::new(
                ErrorKind::ContextConflict,
                "目标执行已结束或已切换，请查看当前状态",
            ));
        }
        let receipt = json!({"sessionId":id,"fingerprint":fingerprint,"runId":active_run,"cancelRequested":true});
        let receipt = receipt_key.as_deref().map(|key| (key, &receipt));
        if !view.active {
            if !view.queue.is_empty() {
                view.queue_paused = true;
                view.stop_reason = Some("cancelled".into());
                self.commit_with_stop_receipt(
                    &entry,
                    view,
                    "queue.stop_requested",
                    &json!({}),
                    receipt,
                )
                .await
                .map_err(|_| DomainError::storage())?;
                self.leases
                    .lock()
                    .expect("leases poisoned")
                    .retain(|_, owner| owner != id);
                entry.wake.notify_one();
            } else if receipt.is_some() {
                self.commit_with_stop_receipt(&entry, view, "run.stop_noop", &json!({}), receipt)
                    .await
                    .map_err(|_| DomainError::storage())?;
            }
            return Ok(());
        }
        view.queue_paused = true;
        view.status = "cancelling".into();
        self.commit_with_stop_receipt(&entry, view, "run.cancel_requested", &json!({}), receipt)
            .await
            .map_err(|_| DomainError::storage())?;
        if let Some(control) = entry
            .interactions
            .lock()
            .expect("interactions poisoned")
            .as_ref()
        {
            control.cancel();
        }
        if let Some(cancel) = entry.cancel.lock().expect("cancel poisoned").as_ref() {
            let _ = cancel.send(true);
        }
        if let Some(connection) = entry
            .connection
            .lock()
            .expect("connection poisoned")
            .as_ref()
        {
            connection.cancel().map_err(|_| {
                DomainError::new(
                    ErrorKind::DeliveryUncertain,
                    "停止请求已保存，但 Agent 信号投递未确认，请查看执行状态",
                )
            })?;
        }
        entry.wake.notify_one();
        Ok(())
    }

    pub(crate) async fn queue_action(
        self: &Arc<Self>,
        id: &str,
        withdraw: Option<String>,
        pause: bool,
        resume: bool,
        fresh_context: bool,
    ) -> Result<(), DomainError> {
        self.command_available()?;
        let entry = self.command_entry(id)?;
        let _gate = entry.gate.lock().await;
        self.command_available()?;
        let mut view = entry.view.lock().expect("view poisoned").clone();
        if pause && (resume || fresh_context || withdraw.is_some()) {
            return Err(DomainError::new(
                ErrorKind::InvalidInput,
                "暂停不能与恢复或撤回同时提交",
            ));
        }
        if pause {
            if view.queue.is_empty() {
                return Err(DomainError::new(
                    ErrorKind::QueueConflict,
                    "没有待暂停的排队消息，消息可能已经开始执行",
                ));
            }
            view.queue_paused = true;
        }
        if let Some(withdraw) = withdraw {
            let position = view
                .queue
                .iter()
                .position(|run| run.id == withdraw)
                .ok_or_else(|| {
                    DomainError::new(ErrorKind::QueueConflict, "消息已开始执行或已撤回")
                })?;
            view.queue.remove(position);
            if let Some(run) = view.runs.iter_mut().find(|run| run.id == withdraw) {
                run.status = "withdrawn".into();
                run.finished_at = Some(now());
            }
        }
        if resume {
            if view.archived || (view.active && fresh_context) {
                return Err(DomainError::new(
                    ErrorKind::QueueConflict,
                    "当前会话不能恢复队列",
                ));
            }
            if view.history_only && !fresh_context {
                return Err(DomainError::new(
                    ErrorKind::ContextConflict,
                    "重启后需要明确同意在新 Agent 上下文中执行队列",
                ));
            }
            if fresh_context {
                if let Some(state) = view.agent_state.as_object_mut() {
                    for key in ["resumeSessionId", "contextRestoreState", "contextResumedAt"] {
                        state.remove(key);
                    }
                }
                view.history_only = false;
                view.status = "idle".into();
                view.error = None;
                view.agent_state["contextRestartedAt"] = json!(now());
            }
            view.queue_paused = false;
        }
        let release_lease = !view.active && (view.queue_paused || view.queue.is_empty());
        self.commit(
            &entry,
            view,
            "queue.updated",
            &json!({"pause":pause,"resume":resume}),
        )
        .await
        .map_err(|_| DomainError::storage())?;
        if release_lease {
            self.leases
                .lock()
                .expect("leases poisoned")
                .retain(|_, owner| owner != id);
        }
        self.driver(entry.clone());
        Ok(())
    }
}

#[cfg(test)]
mod input_delivery_tests {
    use super::*;
    #[tokio::test]
    async fn cancelled_input_resolution_cannot_upgrade_an_uncertain_decision_to_sent() {
        let directory = tempfile::tempdir().unwrap();
        let workbench = Workbench::open(
            directory.path(),
            vec![Provider {
                id: "demo".into(),
                name: "Demo".into(),
                available: true,
                description: String::new(),
                command: PathBuf::from("unused"),
                args: vec![],
            }],
        )
        .await
        .unwrap();
        let id = workbench
            .create("demo", directory.path().to_str().unwrap(), None)
            .await
            .unwrap();
        let entry = workbench.entry(&id).unwrap();
        entry.view.lock().unwrap().decisions.push(serde_json::from_value(json!({"id":"saved-input","requestId":"input","answer":{"action":"accept","content":{"name":"value"}},"delivery":"uncertain"})).unwrap());
        workbench
            .apply_event(
                &entry,
                0,
                "connection",
                json!({"type":"input_resolved","id":"input","received":false}),
            )
            .await
            .unwrap();
        assert_eq!(
            entry.view.lock().unwrap().decisions[0].delivery,
            "uncertain"
        );
        workbench
            .apply_event(
                &entry,
                0,
                "connection",
                json!({"type":"input_resolved","id":"input","received":true}),
            )
            .await
            .unwrap();
        assert_eq!(entry.view.lock().unwrap().decisions[0].delivery, "sent");
        workbench.close().await;
    }
}
