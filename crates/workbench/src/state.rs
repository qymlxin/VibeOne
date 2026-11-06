use crate::{projection::SessionView, providers::Provider};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering},
    },
};
use tokio::sync::{broadcast, watch};
use vibeone_agent_client::{AgentInteractions, AgentSession};
mod artifacts;
mod attachments;
mod catalog;
mod execution;
mod history;
mod outbox;
mod sync;
use vibeone_storage::{SavedSession, Store, Workspace};

pub struct Entry {
    pub view: Mutex<SessionView>,
    gate: tokio::sync::Mutex<()>,
    revision: AtomicI64,
    connection: Mutex<Option<Arc<AgentSession>>>,
    interactions: Mutex<Option<Arc<AgentInteractions>>>,
    cancel: Mutex<Option<watch::Sender<bool>>>,
    wake: tokio::sync::Notify,
    driver: AtomicBool,
    generation: AtomicU64,
    configuring: AtomicBool,
    provider_lease: Mutex<Option<vibeone_plugin_host::PluginLease>>,
}
struct FlagReset<'a>(&'a AtomicBool);
impl Drop for FlagReset<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}
impl Entry {
    fn new(view: SessionView, revision: i64) -> Arc<Self> {
        Arc::new(Self {
            view: Mutex::new(view),
            gate: tokio::sync::Mutex::new(()),
            revision: AtomicI64::new(revision),
            connection: Mutex::default(),
            interactions: Mutex::default(),
            cancel: Mutex::default(),
            wake: tokio::sync::Notify::new(),
            driver: AtomicBool::new(false),
            generation: AtomicU64::new(0),
            configuring: AtomicBool::new(false),
            provider_lease: Mutex::default(),
        })
    }
}

pub struct Workbench {
    directory: PathBuf,
    pub providers: Vec<Provider>,
    pub(crate) plugins: crate::plugins::Plugins,
    pub sessions: Mutex<HashMap<String, Arc<Entry>>>,
    pub revision: AtomicU64,
    pub events: broadcast::Sender<u64>,
    store: Store,
    workspaces: Mutex<Vec<Workspace>>,
    catalog_gate: tokio::sync::Mutex<()>,
    publication: Mutex<()>,
    sync_gate: tokio::sync::Mutex<()>,
    sync_epoch: String,
    leases: Mutex<HashMap<String, String>>,
    catalog: Mutex<HashMap<String, HashMap<String, Value>>>,
    stopping: AtomicBool,
    storage_error: Mutex<Option<String>>,
}

impl Workbench {
    pub async fn open(directory: &Path, providers: Vec<Provider>) -> Result<Arc<Self>, String> {
        let store = Store::open(directory)
            .await
            .map_err(|error| error.to_string())?;
        // One-time, restartable import from the prior in-memory Host. Existing records win.
        let legacy = directory.join("legacy-snapshot.json");
        if legacy.is_file() {
            if std::fs::metadata(&legacy)
                .map_err(|error| error.to_string())?
                .len()
                > 256 * 1024 * 1024
            {
                return Err("旧版会话导出超过导入限制；原文件已保留".into());
            }
            let snapshot: Value = serde_json::from_slice(
                &tokio::fs::read(&legacy)
                    .await
                    .map_err(|error| error.to_string())?,
            )
            .map_err(|error| error.to_string())?;
            let known: std::collections::HashSet<_> = store
                .sessions()
                .await
                .map_err(|error| error.to_string())?
                .into_iter()
                .map(|saved| saved.id)
                .collect();
            for raw in snapshot["sessions"]
                .as_array()
                .ok_or("旧版会话导出格式无效")?
            {
                let view: SessionView =
                    serde_json::from_value(raw.clone()).map_err(|error| error.to_string())?;
                if known.contains(&view.id) {
                    continue;
                }
                store
                    .save(
                        &SavedSession {
                            id: view.id.clone(),
                            workspace: view.workspace.clone(),
                            revision: 1,
                            snapshot: raw.clone(),
                        },
                        "session.imported",
                        &json!({"source":"legacy"}),
                    )
                    .await
                    .map_err(|error| error.to_string())?;
            }
            tokio::fs::remove_file(legacy)
                .await
                .map_err(|error| error.to_string())?;
        }
        store.recover().await.map_err(|error| error.to_string())?;
        let mut sessions = HashMap::new();
        for saved in store.sessions().await.map_err(|error| error.to_string())? {
            let saved = history::prepare(&store, saved).await?;
            let view = serde_json::from_value(saved.snapshot).map_err(|error| error.to_string())?;
            sessions.insert(saved.id, Entry::new(view, saved.revision));
        }
        let revision = store.cursor().await.map_err(|error| error.to_string())?;
        let workspaces = store
            .workspaces()
            .await
            .map_err(|error| error.to_string())?;
        let mut catalog = HashMap::<String, HashMap<String, Value>>::new();
        for (kind, id, value) in store.catalog().await.map_err(|error| error.to_string())? {
            catalog.entry(kind).or_default().insert(id, value);
        }
        Ok(Arc::new(Self {
            directory: directory.to_path_buf(),
            providers,
            plugins: crate::plugins::Plugins::new(directory.to_path_buf()),
            sessions: Mutex::new(sessions),
            revision: AtomicU64::new(revision),
            events: broadcast::channel(128).0,
            store,
            workspaces: Mutex::new(workspaces),
            catalog_gate: tokio::sync::Mutex::new(()),
            publication: Mutex::new(()),
            sync_gate: tokio::sync::Mutex::new(()),
            sync_epoch: uuid::Uuid::new_v4().to_string(),
            leases: Mutex::default(),
            catalog: Mutex::new(catalog),
            stopping: AtomicBool::new(false),
            storage_error: Mutex::default(),
        }))
    }
    fn available(&self) -> Result<(), String> {
        if let Some(error) = self
            .storage_error
            .lock()
            .expect("storage error poisoned")
            .as_ref()
        {
            return Err(error.clone());
        }
        if self.stopping.load(Ordering::SeqCst) {
            return Err("Host 正在停止".into());
        }
        Ok(())
    }
    fn changed(&self, cursor: u64) {
        self.revision.fetch_max(cursor, Ordering::SeqCst);
        let _ = self.events.send(self.revision.load(Ordering::SeqCst));
    }
    fn fail_storage(&self, error: impl std::fmt::Display) -> String {
        let _publication = self.publication.lock().expect("publication poisoned");
        let message = format!("本地存储失败，已停止接收新执行：{error}");
        *self.storage_error.lock().expect("storage error poisoned") = Some(message.clone());
        let entries: Vec<_> = self
            .sessions
            .lock()
            .expect("sessions poisoned")
            .values()
            .cloned()
            .collect();
        for entry in entries {
            entry.wake.notify_one();
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
            if let Some(connection) = entry.connection.lock().expect("connection poisoned").take() {
                let _ = connection.cancel();
            }
            let mut view = entry.view.lock().expect("view poisoned");
            if view.active {
                view.active = false;
                view.queue_paused = true;
                view.status = "error".into();
                view.error = Some(message.clone());
                view.approvals.clear();
                view.inputs.clear();
            }
        }
        self.changed(self.revision.load(Ordering::SeqCst));
        message
    }
    // Caller holds entry.gate: no new projection is visible before its transaction commits.
    async fn commit(
        &self,
        entry: &Entry,
        mut view: SessionView,
        kind: &str,
        event: &Value,
    ) -> Result<(), String> {
        let _sync = self.sync_gate.lock().await;
        if let Some(error) = self
            .storage_error
            .lock()
            .expect("storage error poisoned")
            .as_ref()
        {
            return Err(error.clone());
        }
        view.last_activity_at = execution::now();
        let revision = entry.revision.load(Ordering::SeqCst) + 1;
        history::stamp(
            &mut view,
            &entry.view.lock().expect("view poisoned"),
            revision as u64,
        )?;
        let record = SavedSession {
            id: view.id.clone(),
            workspace: view.workspace.clone(),
            revision,
            snapshot: serde_json::to_value(&view).map_err(|error| error.to_string())?,
        };
        let cursor = self
            .store
            .save(&record, kind, event)
            .await
            .map_err(|error| self.fail_storage(error))?;
        let _publication = self.publication.lock().expect("publication poisoned");
        *entry.view.lock().expect("view poisoned") = view;
        entry.revision.store(revision, Ordering::SeqCst);
        self.changed(cursor);
        Ok(())
    }
    pub fn snapshot(&self) -> Value {
        let _publication = self.publication.lock().expect("publication poisoned");
        let entries: Vec<_> = self
            .sessions
            .lock()
            .expect("sessions poisoned")
            .values()
            .cloned()
            .collect();
        let mut views: Vec<_> = entries
            .iter()
            .map(|entry| entry.view.lock().expect("view poisoned").clone())
            .collect();
        views.sort_by(|a, b| a.id.cmp(&b.id));
        json!({"apiVersion":3,"features":["queuePause","attachments","conversationHistory","cursorSync"],"protocolVersion":2,"sdkVersion":"5.0.0","persistent":true,"storageError":self.storage_error.lock().expect("storage error poisoned").clone(),"revision":self.revision.load(Ordering::SeqCst),"examplePluginPath":std::env::var_os("VIBEONE_EXAMPLE_PLUGIN").map(PathBuf::from).unwrap_or_else(||Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/plugins/workspace-tools")),"pluginEvents":self.plugins.events(),"plugins":self.catalog("plugin"),"notifications":self.catalog("notification"),"profiles":self.catalog("profile"),"providers":self.provider_descriptors(),"sessions":views,"workspaces":*self.workspaces.lock().expect("workspaces poisoned")})
    }
    pub fn entry(&self, id: &str) -> Result<Arc<Entry>, String> {
        self.sessions
            .lock()
            .expect("sessions poisoned")
            .get(id)
            .cloned()
            .ok_or("会话不存在".into())
    }
    pub async fn create(
        &self,
        provider: &str,
        workspace: &str,
        profile_id: Option<&str>,
    ) -> Result<String, String> {
        self.available()?;
        let _catalog = self.catalog_gate.lock().await;
        let mut profile = match profile_id {
            Some(id) => Some(
                self.catalog("profile")
                    .into_iter()
                    .find(|item| item["id"] == id)
                    .ok_or("Agent Profile 不存在")?,
            ),
            None => None,
        };
        let provider = profile
            .as_ref()
            .and_then(|item| item["provider"].as_str())
            .unwrap_or(provider);
        let provider = self
            .provider_descriptors()
            .into_iter()
            .find(|value| {
                value.id == provider
                    && (value.available
                        || profile.as_ref().is_some_and(|profile| {
                            profile["command"]
                                .as_str()
                                .is_some_and(|command| Path::new(command).is_file())
                        }))
            })
            .ok_or("工具未安装或 Node 不可用，请先检查环境")?;
        let provider_lease = if let Some((plugin_id, _)) = provider.id.split_once(':') {
            let lease = self.plugins.acquire(plugin_id)?;
            if !self.catalog("plugin").iter().any(|record| {
                record["id"] == plugin_id && record["generation"] == lease.key().generation
            }) {
                return Err("Provider 正在更新，请稍后重试".into());
            }
            let mut pinned = profile
                .take()
                .unwrap_or_else(|| json!({"name":provider.name,"provider":provider.id}));
            pinned["command"] = json!(provider.command);
            pinned["args"] = json!(provider.args);
            pinned["pluginId"] = json!(plugin_id);
            pinned["generation"] = json!(lease.key().generation);
            profile = Some(pinned);
            Some(lease)
        } else {
            None
        };
        if workspace.trim().is_empty() && provider.id.contains(':') {
            return Err("插件 Agent 需要选择已经授权的工作区".into());
        }
        let workspace = if workspace.trim().is_empty() {
            let path = self
                .directory
                .join("projects")
                .join(format!("project-{}", uuid::Uuid::new_v4()));
            let mut builder = std::fs::DirBuilder::new();
            builder.recursive(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::DirBuilderExt;
                builder.mode(0o700);
            }
            builder
                .create(&path)
                .map_err(|error| format!("默认项目创建失败：{error}"))?;
            path
        } else {
            PathBuf::from(workspace)
        };
        let workspace = workspace.canonicalize().map_err(|_| "工作目录不存在")?;
        if !workspace.is_dir() {
            return Err("请选择目录作为工作区".into());
        }
        if let Some((plugin_id, _)) = provider.id.split_once(':') {
            let record = self
                .catalog("plugin")
                .into_iter()
                .find(|item| item["id"] == plugin_id)
                .ok_or("Provider 插件不存在")?;
            let known = self
                .workspaces
                .lock()
                .expect("workspaces poisoned")
                .iter()
                .find(|item| Path::new(&item.path) == workspace)
                .map(|item| item.id.clone());
            if !record["workspaces"].as_array().is_some_and(|items| {
                known
                    .as_ref()
                    .is_some_and(|id| items.iter().any(|item| item == id))
            }) {
                return Err("Provider 插件未获授权访问此工作区".into());
            }
        }

        let count = self
            .sessions
            .lock()
            .expect("sessions poisoned")
            .values()
            .filter(|entry| !entry.view.lock().expect("view poisoned").archived)
            .count();
        if count >= 128 {
            return Err("活动会话已达到上限，请归档不用的会话".into());
        }
        let id = uuid::Uuid::new_v4().to_string();
        let view = SessionView {
            last_activity_at: execution::now(),
            history_sequence: 0,
            id: id.clone(),
            title: "新会话".into(),
            workspace: workspace.to_string_lossy().into_owned(),
            provider: provider.id.clone(),
            status: "idle".into(),
            messages: vec![],
            tools: vec![],
            approvals: vec![],
            inputs: vec![],
            error: None,
            stop_reason: None,
            active: false,
            observed_active: false,
            history_only: false,
            archived: false,
            runs: vec![],
            queue: vec![],
            queue_paused: false,
            decisions: vec![],
            profile,
            agent_state: Value::Null,
        };
        let record = SavedSession {
            id: id.clone(),
            workspace: view.workspace.clone(),
            revision: 1,
            snapshot: serde_json::to_value(&view).map_err(|error| error.to_string())?,
        };
        let _sync = self.sync_gate.lock().await;
        let cursor = self
            .store
            .save(&record, "session.created", &json!({}))
            .await
            .map_err(|error| self.fail_storage(error))?;
        let workspaces = self
            .store
            .workspaces()
            .await
            .map_err(|error| self.fail_storage(error))?;
        let _publication = self.publication.lock().expect("publication poisoned");
        let entry = Entry::new(view, 1);
        *entry
            .provider_lease
            .lock()
            .expect("provider lease poisoned") = provider_lease;
        self.sessions
            .lock()
            .expect("sessions poisoned")
            .insert(id.clone(), entry);
        *self.workspaces.lock().expect("workspaces poisoned") = workspaces;
        self.changed(cursor);
        Ok(id)
    }
    pub async fn decide(&self, id: &str, request: &str, option: &str) -> Result<(), String> {
        self.available()?;
        let entry = self.entry(id)?;
        let _gate = entry.gate.lock().await;
        let mut view = entry.view.lock().expect("view poisoned").clone();
        if let Some(decision) = view
            .decisions
            .iter()
            .find(|item| item["requestId"] == request)
        {
            return if decision["option"] == option {
                Ok(())
            } else {
                Err("该请求已选择其他选项".into())
            };
        }
        let approval = view
            .approvals
            .iter()
            .find(|approval| approval["id"] == request)
            .ok_or("审批已失效或已处理")?;
        if !approval["options"]
            .as_array()
            .is_some_and(|options| options.iter().any(|item| item["optionId"] == option))
        {
            return Err("审批选项无效".into());
        }
        view.approvals.retain(|approval| approval["id"] != request);
        let connection = entry
            .interactions
            .lock()
            .expect("interactions poisoned")
            .clone()
            .ok_or("Agent 未连接")?;
        view.decisions.push(json!({"id":uuid::Uuid::new_v4().to_string(),"requestId":request,"option":option,"delivery":"pending","createdAt":execution::now()}));
        // Persist the unique decision before delivery. Approvals are never replayed after restart.
        self.commit(
            &entry,
            view,
            "approval.submitted",
            &json!({"requestId":request,"option":option}),
        )
        .await?;
        if let Err(error) = connection.decide(request, option) {
            let mut view = entry.view.lock().expect("view poisoned").clone();
            if let Some(decision) = view
                .decisions
                .iter_mut()
                .find(|item| item["requestId"] == request)
            {
                decision["delivery"] = json!("uncertain");
            }
            self.commit(
                &entry,
                view,
                "approval.delivery_uncertain",
                &json!({"requestId":request}),
            )
            .await?;
            return Err(error);
        }
        Ok(())
    }
    pub async fn answer(&self, id: &str, request: &str, answer: Value) -> Result<(), String> {
        self.available()?;
        let entry = self.entry(id)?;
        let _gate = entry.gate.lock().await;
        let mut view = entry.view.lock().expect("view poisoned").clone();
        if let Some(previous) = view
            .decisions
            .iter()
            .find(|item| item["requestId"] == request)
        {
            return if previous["answer"] == answer {
                Ok(())
            } else {
                Err("该问题已提交其他回答".into())
            };
        }
        if !view.inputs.iter().any(|input| input["id"] == request) {
            return Err("补充输入已失效或已处理".into());
        }
        let connection = entry
            .interactions
            .lock()
            .expect("interactions poisoned")
            .clone()
            .ok_or("Agent 未连接")?;
        connection.validate_input(request, &answer)?;
        view.inputs.retain(|input| input["id"] != request);
        view.decisions.push(json!({"id":uuid::Uuid::new_v4().to_string(),"requestId":request,"answer":answer,"delivery":"pending","createdAt":execution::now()}));
        self.commit(
            &entry,
            view,
            "input.submitted",
            &json!({"requestId":request}),
        )
        .await?;
        connection.answer(request, answer)
    }
    pub async fn configure(&self, id: &str, config_id: &str, value: Value) -> Result<(), String> {
        self.available()?;
        let entry = self.entry(id)?;
        let connection = {
            let _gate = entry.gate.lock().await;
            let view = entry.view.lock().expect("view poisoned");
            if view.active
                || !view.queue.is_empty()
                || view.history_only
                || entry.configuring.load(Ordering::SeqCst)
            {
                return Err("请在当前执行与队列结束后修改配置".into());
            }
            if !view.agent_state["configOptions"]
                .as_array()
                .is_some_and(|options| options.iter().any(|option| option["configId"] == config_id))
            {
                return Err("配置项不存在或 Agent 未声明支持".into());
            }
            let connection = entry
                .connection
                .lock()
                .expect("connection poisoned")
                .clone()
                .ok_or("Agent 未连接")?;
            entry.configuring.store(true, Ordering::SeqCst);
            connection
        };
        let _reset = FlagReset(&entry.configuring);
        let result = connection.configure(config_id, value).await;
        let _gate = entry.gate.lock().await;
        entry.configuring.store(false, Ordering::SeqCst);
        let response = result?;
        let mut view = entry.view.lock().expect("view poisoned").clone();
        view.agent_state["configOptions"] = response["configOptions"].clone();
        self.commit(
            &entry,
            view,
            "agent.configured",
            &json!({"configId":config_id}),
        )
        .await
    }
    pub async fn metadata(
        &self,
        id: &str,
        title: Option<String>,
        archived: Option<bool>,
    ) -> Result<(), String> {
        self.available()?;
        let entry = self.entry(id)?;
        let _gate = entry.gate.lock().await;
        let mut view = entry.view.lock().expect("view poisoned").clone();
        if let Some(title) = title {
            let title = title.trim();
            if title.is_empty() || title.chars().count() > 120 {
                return Err("会话标题须为 1–120 个字符".into());
            }
            view.title = title.into();
        }
        if let Some(archived) = archived {
            if view.active
                || !view.queue.is_empty()
                || !view.approvals.is_empty()
                || !view.inputs.is_empty()
            {
                return Err("请先完成或停止运行并清空队列".into());
            }
            view.archived = archived;
        }
        self.commit(&entry, view, "session.metadata_updated", &json!({}))
            .await
    }
    pub async fn stop(&self) {
        if self.stopping.swap(true, Ordering::SeqCst) {
            return;
        }
        let entries: Vec<_> = self
            .sessions
            .lock()
            .expect("sessions poisoned")
            .values()
            .cloned()
            .collect();
        for entry in entries {
            entry.wake.notify_one();
            let _gate = entry.gate.lock().await;
            if let Some(control) = entry
                .interactions
                .lock()
                .expect("interactions poisoned")
                .as_ref()
            {
                control.cancel();
            }
            let mut view = entry.view.lock().expect("view poisoned").clone();
            if view.active {
                view.active = false;
                view.status = "interrupted".into();
                view.stop_reason = Some("interrupted".into());
                view.approvals.clear();
                view.inputs.clear();
                let _ = self
                    .commit(
                        &entry,
                        view,
                        "run.interrupted",
                        &json!({"reason":"host_stopped"}),
                    )
                    .await;
            }
            if let Some(cancel) = entry.cancel.lock().expect("cancel poisoned").as_ref() {
                let _ = cancel.send(true);
            }
            if let Some(connection) = entry.connection.lock().expect("connection poisoned").take() {
                let _ = connection.cancel();
            }
        }
    }
    pub async fn close(&self) {
        self.store.close().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn legacy_sessions_survive_recovery_with_missing_or_null_execution_lists() {
        let directory = tempfile::tempdir().unwrap();
        let store = Store::open(directory.path()).await.unwrap();
        for (id, fields) in [
            ("missing", json!({})),
            (
                "null",
                json!({"runs":null,"decisions":null,"queue":null,"inputs":null}),
            ),
        ] {
            let mut snapshot = json!({"id":id,"workspace":"/old-workspace","title":"Old conversation","provider":"demo","status":"idle","messages":[{"id":"old-message","text":"Preserve history"}],"tools":[],"approvals":[],"error":null,"stopReason":"end_turn"});
            snapshot
                .as_object_mut()
                .unwrap()
                .extend(fields.as_object().unwrap().clone());
            store
                .save(
                    &SavedSession {
                        id: id.into(),
                        workspace: "/old-workspace".into(),
                        revision: 1,
                        snapshot,
                    },
                    "session.created",
                    &json!({}),
                )
                .await
                .unwrap();
        }
        store.close().await;
        std::fs::write(directory.path().join("legacy-snapshot.json"), serde_json::to_vec(&json!({"sessions":[{"id":"imported","workspace":"/old-workspace","title":"Old conversation","provider":"demo","status":"idle","messages":[{"id":"old-message","text":"Preserve history"}],"tools":[],"approvals":[],"runs":null,"decisions":null,"inputs":null,"queue":null}]})).unwrap()).unwrap();
        for _ in 0..2 {
            let workbench = Workbench::open(directory.path(), vec![])
                .await
                .expect("legacy database must start without Load failed");
            let snapshot = workbench.snapshot();
            assert_eq!(snapshot["sessions"].as_array().unwrap().len(), 3);
            for session in snapshot["sessions"].as_array().unwrap() {
                assert_eq!(session["messages"][0]["text"], "Preserve history");
                assert_eq!(session["historyOnly"], true);
                for field in ["runs", "decisions", "queue", "inputs"] {
                    assert_eq!(session[field], json!([]));
                }
            }
            workbench.close().await;
        }
    }

    #[tokio::test]
    async fn failed_storage_never_publishes_a_session_or_accepts_another_run() {
        let directory = tempfile::tempdir().unwrap();
        let provider = Provider {
            id: "test".into(),
            name: "test".into(),
            available: true,
            description: String::new(),
            command: PathBuf::from("unused"),
            args: vec![],
        };
        let workbench = Workbench::open(directory.path(), vec![provider])
            .await
            .unwrap();
        workbench.store.close().await;
        let error = workbench
            .create("test", directory.path().to_str().unwrap(), None)
            .await
            .unwrap_err();
        assert!(error.contains("存储失败"));
        assert_eq!(workbench.snapshot()["sessions"], json!([]));
        assert!(workbench.snapshot()["storageError"].is_string());
        assert!(
            workbench
                .create("test", directory.path().to_str().unwrap(), None)
                .await
                .is_err()
        );
    }
}
