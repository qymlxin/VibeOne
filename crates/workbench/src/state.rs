use crate::domain_error::{DomainError, ErrorKind};
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
mod context;
mod execution;
mod history;
mod operations;
mod outbox;
mod probe;
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
    operation_gate: tokio::sync::Mutex<()>,
    leases: Mutex<HashMap<String, String>>,
    catalog: Mutex<HashMap<String, HashMap<String, Value>>>,
    stopping: AtomicBool,
    probe_gate: tokio::sync::Mutex<()>,
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
        for (kind, id, mut value) in store.catalog().await.map_err(|error| error.to_string())? {
            if kind == "operation"
                && matches!(value["state"].as_str(), Some("accepted" | "running"))
            {
                value["state"] = json!("interrupted");
                value["finishedAt"] = json!(execution::now());
                value["error"] = json!({"code":"HOST_INTERRUPTED","message":"主机已重启，操作结果不确定；未自动重放。"});
                store
                    .put_catalog("operation", &id, &value)
                    .await
                    .map_err(|error| error.to_string())?;
            }
        }
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
            operation_gate: tokio::sync::Mutex::new(()),
            leases: Mutex::default(),
            catalog: Mutex::new(catalog),
            stopping: AtomicBool::new(false),
            probe_gate: tokio::sync::Mutex::new(()),
            storage_error: Mutex::default(),
        }))
    }
    #[cfg(test)]
    pub(crate) async fn close_storage_for_test(&self) {
        self.store.close().await;
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
    pub(crate) fn command_available(&self) -> Result<(), DomainError> {
        if self
            .storage_error
            .lock()
            .expect("storage error poisoned")
            .is_some()
        {
            return Err(DomainError::storage());
        }
        if self.stopping.load(Ordering::SeqCst) {
            return Err(DomainError::new(
                ErrorKind::HostUnavailable,
                "Host 正在停止",
            ));
        }
        Ok(())
    }
    fn command_entry(&self, id: &str) -> Result<Arc<Entry>, DomainError> {
        self.entry(id)
            .map_err(|_| DomainError::new(ErrorKind::SessionNotFound, "会话不存在"))
    }
    pub(crate) fn session_workspace(&self, id: &str) -> Result<String, DomainError> {
        Ok(self
            .command_entry(id)?
            .view
            .lock()
            .expect("view poisoned")
            .workspace
            .clone())
    }
    // Call while holding catalog_gate so creation and unarchive share one limit.
    fn check_session_capacity(&self) -> Result<(), DomainError> {
        let count = self
            .sessions
            .lock()
            .expect("sessions poisoned")
            .values()
            .filter(|entry| !entry.view.lock().expect("view poisoned").archived)
            .count();
        if count >= 128 {
            return Err(DomainError::new(
                ErrorKind::SessionLimit,
                "活动会话已达到上限，请归档不用的会话",
            ));
        }
        Ok(())
    }
    fn changed(&self, cursor: u64) {
        self.revision.fetch_max(cursor, Ordering::SeqCst);
        let _ = self.events.send(self.revision.load(Ordering::SeqCst));
    }
    fn fail_storage(&self, _error: impl std::fmt::Display) -> String {
        let _publication = self.publication.lock().expect("publication poisoned");
        // This message reaches snapshots and Session errors as well as HTTP responses.
        let message = "本地存储失败，已停止接收新执行；请检查诊断后重启工作主机".to_owned();
        *self.storage_error.lock().expect("storage error poisoned") = Some(message.clone());
        // Durable completion can no longer be established. Do not leave an
        // apparently active receipt permanently blocking recovery/restart.
        if let Some(operations) = self
            .catalog
            .lock()
            .expect("catalog poisoned")
            .get_mut("operation")
        {
            for operation in operations.values_mut() {
                if matches!(operation["state"].as_str(), Some("accepted" | "running")) {
                    operation["state"] = json!("interrupted");
                    operation["finishedAt"] = json!(execution::now());
                    operation["error"] = json!({"code":"STORAGE_UNAVAILABLE","message":"主机存储不可用，操作结果不确定；请检查诊断后重启主机，不要直接重复执行。"});
                }
            }
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
        serde_json::to_value(self.snapshot_view()).expect("snapshot serializes to JSON")
    }
    pub(crate) fn snapshot_view(&self) -> crate::contracts::SnapshotResponse {
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
        let (profiles, profile_issues) = self.profile_views();
        crate::contracts::SnapshotResponse {
            sessions: views,
            metadata: crate::contracts::SnapshotMetadata {
                api_version: 3,
                features: [
                    "queuePause",
                    "attachments",
                    "directoryReferences",
                    "providerProbe",
                    "upstreamResume",
                    "conversationHistory",
                    "cursorSync",
                    "pluginOperations",
                    "pluginLifecycleOperations",
                    "structuredErrors",
                ]
                .into_iter()
                .map(str::to_owned)
                .collect(),
                protocol_version: 2,
                sdk_version: "5.0.0".into(),
                persistent: true,
                storage_error: self
                    .storage_error
                    .lock()
                    .expect("storage error poisoned")
                    .clone(),
                revision: self.revision.load(Ordering::SeqCst),
                example_plugin_path: Some(
                    std::env::var_os("VIBEONE_EXAMPLE_PLUGIN")
                        .map(PathBuf::from)
                        .unwrap_or_else(|| {
                            Path::new(env!("CARGO_MANIFEST_DIR"))
                                .join("../../examples/plugins/workspace-tools")
                        }),
                ),
                plugin_events: self.plugins.events(),
                operations: self.operation_summaries(),
                plugins: self.catalog("plugin"),
                notifications: self.catalog("notification"),
                profiles,
                profile_issues,
                providers: self.provider_descriptors(),
                workspaces: self
                    .workspaces
                    .lock()
                    .expect("workspaces poisoned")
                    .iter()
                    .map(crate::contracts::WorkspaceView::from)
                    .collect(),
                device: None,
            },
        }
    }
    pub fn entry(&self, id: &str) -> Result<Arc<Entry>, String> {
        self.sessions
            .lock()
            .expect("sessions poisoned")
            .get(id)
            .cloned()
            .ok_or("会话不存在".into())
    }
    pub(crate) async fn create(
        &self,
        provider: &str,
        workspace: &str,
        profile_id: Option<&str>,
    ) -> Result<String, DomainError> {
        self.command_available()?;
        let _catalog = self.catalog_gate.lock().await;
        self.command_available()?;
        let mut profile = profile_id
            .map(|id| {
                self.profile_view(id)
                    .map(crate::contracts::PinnedProfile::from)
            })
            .transpose()?;
        let provider = profile
            .as_ref()
            .and_then(|item| item.provider.as_deref())
            .unwrap_or(provider);
        let provider = self
            .provider_descriptors()
            .into_iter()
            .find(|value| value.id == provider)
            .ok_or_else(|| {
                DomainError::new(ErrorKind::ProviderNotFound, "Agent 入口不存在，请刷新列表")
            })?;
        if !provider.available
            && !profile.as_ref().is_some_and(|profile| {
                profile
                    .details
                    .command
                    .as_deref()
                    .is_some_and(|command| Path::new(command).is_file())
            })
        {
            return Err(DomainError::new(
                ErrorKind::ProviderUnavailable,
                "工具未安装或 Node 不可用，请先检查环境",
            ));
        }
        let provider_lease = if let Some((plugin_id, _)) = provider.id.split_once(':') {
            let lease = self.plugins.acquire(plugin_id).map_err(|_| {
                DomainError::new(
                    ErrorKind::ProviderUnavailable,
                    "Provider 插件不可用，请检查插件状态",
                )
            })?;
            if !self.catalog("plugin").iter().any(|record| {
                record["id"] == plugin_id && record["generation"] == lease.key().generation
            }) {
                return Err(DomainError::new(
                    ErrorKind::ProviderConflict,
                    "Provider 正在更新，请稍后重试",
                ));
            }
            let mut pinned = profile
                .take()
                .unwrap_or_else(|| crate::contracts::PinnedProfile {
                    id: None,
                    name: Some(provider.name.clone()),
                    provider: Some(provider.id.clone()),
                    details: Default::default(),
                });
            pinned.details.command = Some(
                provider
                    .command
                    .to_str()
                    .ok_or_else(|| {
                        DomainError::new(ErrorKind::ProviderUnavailable, "Provider 路径名称无效")
                    })?
                    .into(),
            );
            pinned.details.args = Some(provider.args.clone());
            pinned.details.plugin_id = Some(plugin_id.into());
            pinned.details.generation = Some(lease.key().generation);
            profile = Some(pinned);
            Some(lease)
        } else {
            None
        };
        if workspace.trim().is_empty() && provider.id.contains(':') {
            return Err(DomainError::new(
                ErrorKind::WorkspaceForbidden,
                "插件 Agent 需要选择已经授权的工作区",
            ));
        }
        self.check_session_capacity()?;
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
            builder.create(&path).map_err(|_| {
                DomainError::new(
                    ErrorKind::WorkspaceUnavailable,
                    "默认项目创建失败，请检查主机数据目录及权限",
                )
            })?;
            path
        } else {
            PathBuf::from(workspace)
        };
        let workspace = workspace.canonicalize().map_err(|error| {
            DomainError::new(
                match error.kind() {
                    std::io::ErrorKind::NotFound => ErrorKind::WorkspaceNotFound,
                    std::io::ErrorKind::PermissionDenied => ErrorKind::WorkspaceForbidden,
                    _ => ErrorKind::WorkspaceUnavailable,
                },
                "无法访问工作目录，请检查目录及权限",
            )
        })?;
        if !workspace.is_dir() {
            return Err(DomainError::new(
                ErrorKind::InvalidInput,
                "请选择目录作为工作区",
            ));
        }
        if let Some((plugin_id, _)) = provider.id.split_once(':') {
            let record = self
                .catalog("plugin")
                .into_iter()
                .find(|item| item["id"] == plugin_id)
                .ok_or_else(|| {
                    DomainError::new(ErrorKind::ProviderUnavailable, "Provider 插件不存在")
                })?;
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
                return Err(DomainError::new(
                    ErrorKind::WorkspaceForbidden,
                    "Provider 插件未获授权访问此工作区",
                ));
            }
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
            snapshot: serde_json::to_value(&view)
                .map_err(|_| DomainError::new(ErrorKind::Internal, "会话编码失败"))?,
        };
        let _sync = self.sync_gate.lock().await;
        let cursor = self
            .store
            .save(&record, "session.created", &json!({}))
            .await
            .map_err(|error| {
                self.fail_storage(error);
                DomainError::storage()
            })?;
        let workspaces = self.store.workspaces().await.map_err(|error| {
            self.fail_storage(error);
            DomainError::storage()
        })?;
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
    pub(crate) async fn decide(
        &self,
        id: &str,
        request: &str,
        option: &str,
    ) -> Result<(), DomainError> {
        self.command_available()?;
        let entry = self.command_entry(id)?;
        let _gate = entry.gate.lock().await;
        self.command_available()?;
        let mut view = entry.view.lock().expect("view poisoned").clone();
        if let Some(decision) = view
            .decisions
            .iter()
            .find(|item| item.request_id == request)
        {
            return if decision.option.as_deref() == Some(option) {
                decision_receipt(&decision.delivery)
            } else {
                Err(DomainError::new(
                    ErrorKind::DecisionConflict,
                    "该请求已选择其他选项",
                ))
            };
        }
        let approval = view
            .approvals
            .iter()
            .find(|approval| approval.id == request)
            .ok_or_else(|| DomainError::new(ErrorKind::AttentionExpired, "审批已失效或已处理"))?;
        if approval
            .expires_at
            .is_some_and(|expires| expires <= execution::now())
        {
            return Err(DomainError::new(ErrorKind::AttentionExpired, "审批已过期"));
        }
        if !approval
            .options
            .as_ref()
            .is_some_and(|options| options.iter().any(|item| item.option_id == option))
        {
            return Err(DomainError::new(ErrorKind::InvalidDecision, "审批选项无效"));
        }
        view.approvals.retain(|approval| approval.id != request);
        let connection = entry
            .interactions
            .lock()
            .expect("interactions poisoned")
            .clone()
            .ok_or_else(|| {
                DomainError::new(ErrorKind::AgentDisconnected, "Agent 未连接，请检查会话状态")
            })?;
        view.decisions.push(crate::contracts::DecisionRecord {
            id: uuid::Uuid::new_v4().to_string(),
            request_id: request.into(),
            option: Some(option.into()),
            answer: None,
            delivery: "pending".into(),
            created_at: Some(execution::now()),
            extensions: Default::default(),
        });
        // Persist the unique decision before delivery. Approvals are never replayed after restart.
        self.commit(
            &entry,
            view,
            "approval.submitted",
            &json!({"requestId":request,"option":option}),
        )
        .await
        .map_err(|_| DomainError::storage())?;
        if connection.decide(request, option).is_err() {
            self.attention_delivery_uncertain(&entry, request, "approval.delivery_uncertain")
                .await?;
            return Err(decision_delivery_error());
        }
        Ok(())
    }
    pub(crate) async fn answer(
        &self,
        id: &str,
        request: &str,
        answer: Value,
    ) -> Result<(), DomainError> {
        self.command_available()?;
        let entry = self.command_entry(id)?;
        let _gate = entry.gate.lock().await;
        self.command_available()?;
        let mut view = entry.view.lock().expect("view poisoned").clone();
        if let Some(previous) = view
            .decisions
            .iter()
            .find(|item| item.request_id == request)
        {
            return if previous.answer.as_ref() == Some(&answer) {
                decision_receipt(&previous.delivery)
            } else {
                Err(DomainError::new(
                    ErrorKind::DecisionConflict,
                    "该问题已提交其他回答",
                ))
            };
        }
        if !view.inputs.iter().any(|input| {
            input.id == request
                && !input
                    .expires_at
                    .is_some_and(|expires| expires <= execution::now())
        }) {
            return Err(DomainError::new(
                ErrorKind::AttentionExpired,
                "补充输入已失效或已处理",
            ));
        }
        let connection = entry
            .interactions
            .lock()
            .expect("interactions poisoned")
            .clone()
            .ok_or_else(|| {
                DomainError::new(ErrorKind::AgentDisconnected, "Agent 未连接，请检查会话状态")
            })?;
        connection.check_input(request, &answer).map_err(|error| {
            use vibeone_agent_client::InputValidationError;
            DomainError::new(
                match error {
                    InputValidationError::Expired => ErrorKind::AttentionExpired,
                    InputValidationError::InvalidAnswer => ErrorKind::InvalidAnswer,
                    InputValidationError::InvalidSchema => ErrorKind::UpstreamInvalid,
                },
                error.to_string(),
            )
        })?;
        view.inputs.retain(|input| input.id != request);
        view.decisions.push(crate::contracts::DecisionRecord {
            id: uuid::Uuid::new_v4().to_string(),
            request_id: request.into(),
            option: None,
            answer: Some(answer.clone()),
            delivery: "pending".into(),
            created_at: Some(execution::now()),
            extensions: Default::default(),
        });
        self.commit(
            &entry,
            view,
            "input.submitted",
            &json!({"requestId":request}),
        )
        .await
        .map_err(|_| DomainError::storage())?;
        if connection.answer(request, answer).is_err() {
            self.attention_delivery_uncertain(&entry, request, "input.delivery_uncertain")
                .await?;
            return Err(decision_delivery_error());
        }
        Ok(())
    }
    pub(crate) async fn configure(
        &self,
        id: &str,
        config_id: &str,
        value: Value,
    ) -> Result<(), DomainError> {
        self.command_available()?;
        let entry = self.command_entry(id)?;
        let connection = {
            let _gate = entry.gate.lock().await;
            self.command_available()?;
            let view = entry.view.lock().expect("view poisoned");
            if view.active
                || !view.queue.is_empty()
                || view.history_only
                || view.archived
                || matches!(
                    view.agent_state["contextRestoreState"].as_str(),
                    Some("pending" | "restoring")
                )
                || entry.configuring.load(Ordering::SeqCst)
            {
                return Err(DomainError::new(
                    ErrorKind::ConfigurationBusy,
                    "请在当前执行、队列及上下文恢复结束且取消归档后修改配置",
                ));
            }
            let option = view.agent_state["configOptions"]
                .as_array()
                .and_then(|options| {
                    options
                        .iter()
                        .find(|option| option["configId"] == config_id)
                })
                .ok_or_else(|| {
                    DomainError::new(
                        ErrorKind::ConfigurationUnsupported,
                        "配置项不存在或 Agent 未声明支持",
                    )
                })?;
            validate_config_value(option, &value)?;
            let connection = entry
                .connection
                .lock()
                .expect("connection poisoned")
                .clone()
                .ok_or_else(|| {
                    DomainError::new(ErrorKind::AgentDisconnected, "Agent 未连接，请检查会话状态")
                })?;
            entry.configuring.store(true, Ordering::SeqCst);
            connection
        };
        let _reset = FlagReset(&entry.configuring);
        let result = connection.configure(config_id, value).await;
        let _gate = entry.gate.lock().await;
        self.command_available()?;
        entry.configuring.store(false, Ordering::SeqCst);
        let response = result.map_err(|_| {
            DomainError::new(
                ErrorKind::ConfigurationFailed,
                "Agent 配置更新未确认，请刷新实际配置后重试",
            )
        })?;
        let mut view = entry.view.lock().expect("view poisoned").clone();
        view.agent_state["configOptions"] = response["configOptions"].clone();
        self.commit(
            &entry,
            view,
            "agent.configured",
            &json!({"configId":config_id}),
        )
        .await
        .map_err(|_| DomainError::storage())
    }
    pub(crate) async fn metadata(
        &self,
        id: &str,
        title: Option<String>,
        archived: Option<bool>,
    ) -> Result<(), DomainError> {
        self.command_available()?;
        let entry = self.command_entry(id)?;
        let _catalog = if archived == Some(false) {
            Some(self.catalog_gate.lock().await)
        } else {
            None
        };
        let _gate = entry.gate.lock().await;
        self.command_available()?;
        let mut view = entry.view.lock().expect("view poisoned").clone();
        if let Some(title) = title {
            let title = title.trim();
            if title.is_empty() || title.chars().count() > 120 {
                return Err(DomainError::new(
                    ErrorKind::InvalidInput,
                    "会话标题须为 1–120 个字符",
                ));
            }
            view.title = title.into();
        }
        if let Some(archived) = archived {
            if view.active
                || entry.configuring.load(Ordering::SeqCst)
                || !view.queue.is_empty()
                || !view.approvals.is_empty()
                || !view.inputs.is_empty()
            {
                return Err(DomainError::new(
                    ErrorKind::SessionBusy,
                    "请先完成或停止运行并清空队列",
                ));
            }
            if view.archived && !archived {
                self.check_session_capacity()?;
            }
            view.archived = archived;
        }
        self.commit(&entry, view, "session.metadata_updated", &json!({}))
            .await
            .map_err(|_| DomainError::storage())
    }
    async fn attention_delivery_uncertain(
        &self,
        entry: &Entry,
        request: &str,
        event: &str,
    ) -> Result<(), DomainError> {
        let mut view = entry.view.lock().expect("view poisoned").clone();
        if let Some(decision) = view
            .decisions
            .iter_mut()
            .find(|item| item.request_id == request)
        {
            decision.delivery = "uncertain".into();
        }
        self.commit(entry, view, event, &json!({"requestId":request}))
            .await
            .map_err(|_| DomainError::storage())
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
    async fn execution_failures_keep_storage_identity_without_publishing_work_or_leaking_paths() {
        for attachment in [false, true] {
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
            workbench.store.close().await;
            let error = workbench
                .submit(
                    &id,
                    "must not run".into(),
                    None,
                    vec![],
                    if attachment {
                        vec!["missing".into()]
                    } else {
                        vec![]
                    },
                )
                .await
                .err()
                .expect("command must fail");
            assert_eq!(error.kind, ErrorKind::StorageUnavailable);
            assert!(
                !error
                    .to_string()
                    .contains(directory.path().to_str().unwrap())
            );
            let entry = workbench.entry(&id).unwrap();
            assert!(entry.view.lock().unwrap().runs.is_empty());
            assert!(workbench.leases.lock().unwrap().is_empty());
            if !attachment {
                let next = workbench.cancel(&id).await.expect_err("command must fail");
                assert_eq!(next.kind, ErrorKind::StorageUnavailable);
            }
            workbench.close().await;
        }
    }

    #[tokio::test]
    async fn session_limit_rejects_before_creating_an_unneeded_managed_project() {
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
        let original = workbench.entry(&id).unwrap().view.lock().unwrap().clone();
        for index in 0..127 {
            let mut view = original.clone();
            view.id = format!("capacity-{index}");
            workbench
                .sessions
                .lock()
                .unwrap()
                .insert(view.id.clone(), Entry::new(view, 1));
        }
        assert!(!directory.path().join("projects").exists());
        let error = workbench.create("demo", "", None).await.unwrap_err();
        assert_eq!(error.kind, ErrorKind::SessionLimit);
        assert!(!directory.path().join("projects").exists());
        assert_eq!(workbench.sessions.lock().unwrap().len(), 128);
        workbench.metadata(&id, None, Some(true)).await.unwrap();
        workbench
            .create("demo", directory.path().to_str().unwrap(), None)
            .await
            .unwrap();
        let error = workbench
            .metadata(&id, None, Some(false))
            .await
            .unwrap_err();
        assert_eq!(error.kind, ErrorKind::SessionLimit);
        assert!(workbench.entry(&id).unwrap().view.lock().unwrap().archived);
        workbench.close().await;
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
        assert_eq!(error.kind, ErrorKind::StorageUnavailable);
        assert!(!error.message.contains(directory.path().to_str().unwrap()));
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

#[cfg(test)]
mod cancel_gap_tests {
    use super::*;
    #[tokio::test]
    async fn idle_pause_and_withdraw_release_the_reserved_workspace() {
        for withdraw in [false, true] {
            let directory = tempfile::tempdir().unwrap();
            let provider = Provider {
                id: "demo".into(),
                name: "Demo".into(),
                available: true,
                description: "Fixture".into(),
                command: std::env::current_exe().unwrap(),
                args: vec![],
            };
            let workbench = Workbench::open(directory.path(), vec![provider])
                .await
                .unwrap();
            let id = workbench.create("demo", "", None).await.unwrap();
            let receipt = workbench
                .submit(&id, "queued task".into(), None, vec![], vec![])
                .await
                .unwrap();
            workbench
                .queue_action(
                    &id,
                    withdraw.then_some(receipt.operation_id),
                    !withdraw,
                    false,
                    false,
                )
                .await
                .unwrap();
            let entry = workbench.entry(&id).unwrap();
            assert!(!entry.view.lock().unwrap().active);
            assert!(
                workbench
                    .leases
                    .lock()
                    .unwrap()
                    .values()
                    .all(|owner| owner != &id),
                "an idle paused or withdrawn queue cannot reserve the workspace indefinitely"
            );
            tokio::task::yield_now().await;
            assert!(entry.view.lock().unwrap().messages.is_empty());
            workbench.close().await;
        }
    }

    #[tokio::test]
    async fn stop_before_driver_start_pauses_the_accepted_queue_without_running_it() {
        let directory = tempfile::tempdir().unwrap();
        let provider = Provider {
            id: "demo".into(),
            name: "Demo".into(),
            available: true,
            description: "Fixture".into(),
            command: std::env::current_exe().unwrap(),
            args: vec![],
        };
        let workbench = Workbench::open(directory.path(), vec![provider])
            .await
            .unwrap();
        let id = workbench.create("demo", "", None).await.unwrap();
        let receipt = workbench
            .submit(
                &id,
                "queued task".into(),
                Some("stop-gap".into()),
                vec![],
                vec![],
            )
            .await
            .unwrap();
        let entry = workbench.entry(&id).unwrap();
        assert!(!entry.view.lock().unwrap().active);
        workbench.cancel(&id).await.unwrap();
        {
            let view = entry.view.lock().unwrap();
            assert!(
                view.queue_paused,
                "an accepted stop must not disappear between queue acceptance and driver start"
            );
            assert!(!view.active);
            assert_eq!(view.queue.len(), 1);
            assert_eq!(view.queue[0].id, receipt.operation_id);
            assert_eq!(view.queue[0].status, "queued");
            assert_eq!(view.stop_reason.as_deref(), Some("cancelled"));
            assert!(
                workbench
                    .leases
                    .lock()
                    .unwrap()
                    .values()
                    .all(|owner| owner != &id)
            );
        }
        tokio::task::yield_now().await;
        assert!(!entry.view.lock().unwrap().active);
        assert!(entry.view.lock().unwrap().messages.is_empty());
        workbench.close().await;
    }
}

fn decision_delivery_error() -> DomainError {
    DomainError::new(
        ErrorKind::DeliveryUncertain,
        "决定已保存，但投递未确认，请查看执行状态；不会自动重发",
    )
}
fn decision_receipt(delivery: &str) -> Result<(), DomainError> {
    if matches!(delivery, "pending" | "sent") {
        Ok(())
    } else {
        Err(decision_delivery_error())
    }
}
fn validate_config_value(option: &Value, value: &Value) -> Result<(), DomainError> {
    let kind = option["type"].as_str();
    let supplied = if value.is_object()
        && ((kind == Some("select") && value["type"] == "id")
            || (kind == Some("boolean") && value["type"] == "boolean"))
    {
        &value["value"]
    } else {
        value
    };
    let valid = match kind {
        Some("boolean") => supplied.is_boolean(),
        Some("select") => {
            supplied.is_string()
                && option["options"].as_array().is_some_and(|options| {
                    options.iter().any(|item| {
                        if let Some(group) = item["options"].as_array() {
                            group.iter().any(|choice| choice["value"] == *supplied)
                        } else {
                            item["value"] == *supplied
                        }
                    })
                })
        }
        // Future/custom ACP value kinds remain the upstream Agent's responsibility.
        _ => true,
    };
    if valid {
        Ok(())
    } else {
        Err(DomainError::new(
            ErrorKind::InvalidConfiguration,
            "配置值不在 Agent 声明的选项中或类型不符，请刷新后选择",
        ))
    }
}

#[cfg(test)]
mod attention_command_tests {
    use super::*;
    async fn setup() -> (tempfile::TempDir, Arc<Workbench>, String) {
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
        (directory, workbench, id)
    }
    fn approval() -> crate::contracts::PendingRequest {
        serde_json::from_value(json!({"id":"permission","options":[{"optionId":"allow","name":"Allow","kind":"allow_once"}]})).unwrap()
    }
    #[tokio::test]
    async fn missing_permission_callback_keeps_a_durable_uncertain_receipt_and_never_replays() {
        let (_directory, workbench, id) = setup().await;
        let entry = workbench.entry(&id).unwrap();
        entry.view.lock().unwrap().approvals.push(approval());
        // Simulate a timeout that removed its callback before the projection catches up.
        *entry.interactions.lock().unwrap() = Some(Arc::new(AgentInteractions::default()));
        assert_eq!(
            workbench
                .decide(&id, "permission", "allow")
                .await
                .unwrap_err()
                .kind,
            ErrorKind::DeliveryUncertain
        );
        let revision = entry.revision.load(Ordering::SeqCst);
        assert_eq!(
            workbench
                .decide(&id, "permission", "allow")
                .await
                .unwrap_err()
                .kind,
            ErrorKind::DeliveryUncertain
        );
        assert_eq!(entry.revision.load(Ordering::SeqCst), revision);
        assert_eq!(
            workbench
                .decide(&id, "permission", "reject")
                .await
                .unwrap_err()
                .kind,
            ErrorKind::DecisionConflict
        );
        let saved = workbench.store.sessions().await.unwrap();
        let view = &saved.iter().find(|item| item.id == id).unwrap().snapshot;
        assert_eq!(view["decisions"].as_array().unwrap().len(), 1);
        assert_eq!(view["decisions"][0]["delivery"], "uncertain");
        assert_eq!(view["approvals"], json!([]));
        // Input uses the same durable transition after a send failure.
        let answer = json!({"action":"cancel"});
        entry.view.lock().unwrap().decisions.push(serde_json::from_value(json!({"id":"decision-input","requestId":"input","delivery":"pending","answer":answer})).unwrap());
        workbench
            .attention_delivery_uncertain(&entry, "input", "input.delivery_uncertain")
            .await
            .unwrap();
        assert_eq!(
            workbench
                .answer(&id, "input", answer)
                .await
                .unwrap_err()
                .kind,
            ErrorKind::DeliveryUncertain
        );
        let saved = workbench.store.sessions().await.unwrap();
        assert!(
            saved.iter().find(|item| item.id == id).unwrap().snapshot["decisions"]
                .as_array()
                .unwrap()
                .iter()
                .any(|item| item["requestId"] == "input" && item["delivery"] == "uncertain")
        );
        workbench.close().await;
    }
    #[tokio::test]
    async fn storage_failure_and_expiry_never_consume_an_approval_or_publish_a_decision() {
        for expired in [false, true] {
            let (_directory, workbench, id) = setup().await;
            let entry = workbench.entry(&id).unwrap();
            let mut pending = approval();
            if expired {
                pending.expires_at = Some(1);
            }
            entry.view.lock().unwrap().approvals.push(pending);
            *entry.interactions.lock().unwrap() = Some(Arc::new(AgentInteractions::default()));
            if !expired {
                workbench.store.close().await;
            }
            let result = workbench
                .decide(&id, "permission", "allow")
                .await
                .unwrap_err();
            assert_eq!(
                result.kind,
                if expired {
                    ErrorKind::AttentionExpired
                } else {
                    ErrorKind::StorageUnavailable
                }
            );
            {
                let view = entry.view.lock().unwrap();
                assert_eq!(view.approvals.len(), 1);
                assert!(view.decisions.is_empty());
            }
            workbench.close().await;
        }
    }
    #[test]
    fn known_config_values_validate_grouped_selects_and_boolean_types() {
        let select =
            json!({"type":"select","options":[{"group":"models","options":[{"value":"model-a"}]}]});
        assert!(validate_config_value(&select, &json!("model-a")).is_ok());
        assert!(validate_config_value(&select, &json!({"type":"id","value":"model-a"})).is_ok());
        assert_eq!(
            validate_config_value(&select, &json!("unknown"))
                .unwrap_err()
                .kind,
            ErrorKind::InvalidConfiguration
        );
        assert!(validate_config_value(&json!({"type":"boolean"}), &json!(false)).is_ok());
        assert!(validate_config_value(&json!({"type":"boolean"}), &json!("false")).is_err());
        assert!(
            validate_config_value(
                &json!({"type":"_future"}),
                &json!({"type":"_future","value":3})
            )
            .is_ok()
        );
    }
}
