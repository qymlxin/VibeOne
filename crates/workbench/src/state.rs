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
use vibeone_agent_client::{AgentSession, event_sink};
use vibeone_storage::{SavedSession, Store, Workspace};

pub struct Entry {
    pub view: Mutex<SessionView>,
    gate: tokio::sync::Mutex<()>,
    revision: AtomicI64,
    connection: Mutex<Option<Arc<AgentSession>>>,
    cancel: Mutex<Option<watch::Sender<bool>>>,
}
impl Entry {
    fn new(view: SessionView, revision: i64) -> Arc<Self> {
        Arc::new(Self {
            view: Mutex::new(view),
            gate: tokio::sync::Mutex::new(()),
            revision: AtomicI64::new(revision),
            connection: Mutex::default(),
            cancel: Mutex::default(),
        })
    }
}

pub struct Workbench {
    pub providers: Vec<Provider>,
    pub sessions: Mutex<HashMap<String, Arc<Entry>>>,
    pub revision: AtomicU64,
    pub events: broadcast::Sender<u64>,
    store: Store,
    workspaces: Mutex<Vec<Workspace>>,
    catalog_gate: tokio::sync::Mutex<()>,
    publication: Mutex<()>,
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
            let view = serde_json::from_value(saved.snapshot).map_err(|error| error.to_string())?;
            sessions.insert(saved.id, Entry::new(view, saved.revision));
        }
        let revision = store.cursor().await.map_err(|error| error.to_string())?;
        let workspaces = store
            .workspaces()
            .await
            .map_err(|error| error.to_string())?;
        Ok(Arc::new(Self {
            providers,
            sessions: Mutex::new(sessions),
            revision: AtomicU64::new(revision),
            events: broadcast::channel(128).0,
            store,
            workspaces: Mutex::new(workspaces),
            catalog_gate: tokio::sync::Mutex::new(()),
            publication: Mutex::new(()),
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
            if let Some(connection) = entry.connection.lock().expect("connection poisoned").take() {
                let _ = connection.cancel();
            }
            let mut view = entry.view.lock().expect("view poisoned");
            if view.active {
                view.active = false;
                view.status = "error".into();
                view.error = Some(message.clone());
                view.approvals.clear();
            }
        }
        self.changed(self.revision.load(Ordering::SeqCst));
        message
    }
    // Caller holds entry.gate: no new projection is visible before its transaction commits.
    async fn commit(
        &self,
        entry: &Entry,
        view: SessionView,
        kind: &str,
        event: &Value,
    ) -> Result<(), String> {
        if let Some(error) = self
            .storage_error
            .lock()
            .expect("storage error poisoned")
            .as_ref()
        {
            return Err(error.clone());
        }
        let revision = entry.revision.load(Ordering::SeqCst) + 1;
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
        json!({"protocolVersion":2,"sdkVersion":"5.0.0","persistent":true,"storageError":self.storage_error.lock().expect("storage error poisoned").clone(),"revision":self.revision.load(Ordering::SeqCst),"providers":self.providers,"sessions":views,"workspaces":*self.workspaces.lock().expect("workspaces poisoned")})
    }
    pub fn entry(&self, id: &str) -> Result<Arc<Entry>, String> {
        self.sessions
            .lock()
            .expect("sessions poisoned")
            .get(id)
            .cloned()
            .ok_or("会话不存在".into())
    }
    pub async fn create(&self, provider: &str, workspace: &str) -> Result<String, String> {
        self.available()?;
        let _catalog = self.catalog_gate.lock().await;
        let provider = self
            .providers
            .iter()
            .find(|value| value.id == provider && value.available)
            .ok_or("工具未安装或 Node 不可用，请先检查环境")?;
        let workspace = PathBuf::from(workspace)
            .canonicalize()
            .map_err(|_| "工作目录不存在")?;
        if !workspace.is_dir() {
            return Err("请选择目录作为工作区".into());
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
            id: id.clone(),
            title: "新会话".into(),
            workspace: workspace.to_string_lossy().into_owned(),
            provider: provider.id.clone(),
            status: "idle".into(),
            messages: vec![],
            tools: vec![],
            approvals: vec![],
            error: None,
            stop_reason: None,
            active: false,
            observed_active: false,
            history_only: false,
            archived: false,
        };
        let record = SavedSession {
            id: id.clone(),
            workspace: view.workspace.clone(),
            revision: 1,
            snapshot: serde_json::to_value(&view).map_err(|error| error.to_string())?,
        };
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
        self.sessions
            .lock()
            .expect("sessions poisoned")
            .insert(id.clone(), Entry::new(view, 1));
        *self.workspaces.lock().expect("workspaces poisoned") = workspaces;
        self.changed(cursor);
        Ok(id)
    }
    async fn apply_event(&self, entry: &Entry, event: Value) -> Result<(), String> {
        let _gate = entry.gate.lock().await;
        if self.stopping.load(Ordering::SeqCst) {
            return Ok(());
        }
        let mut view = entry.view.lock().expect("view poisoned").clone();
        view.apply(&event);
        self.commit(entry, view, "agent.update", &event).await
    }
    pub async fn submit(self: &Arc<Self>, id: &str, text: String) -> Result<String, String> {
        self.available()?;
        if text.trim().is_empty() || text.len() > 32_768 {
            return Err("输入不能为空且不能超过 32 KiB".into());
        }
        let entry = self.entry(id)?;
        let gate = entry.gate.lock().await;
        let mut view = entry.view.lock().expect("view poisoned").clone();
        if view.active {
            return Err("当前轮次尚未结束，请等待或先停止".into());
        }
        if view.archived {
            return Err("请先取消归档再操作此会话".into());
        }
        if view.history_only {
            return Err("这是重启后恢复的历史会话，请新建会话开始新的执行".into());
        }
        if view.status == "disconnected" {
            return Err("Agent 已断开，请新建会话重试".into());
        }
        view.active = true;
        view.observed_active = false;
        view.status = "starting".into();
        view.error = None;
        view.stop_reason = None;
        if view.title == "新会话" {
            view.title = text.chars().take(28).collect()
        }
        view.messages.push(
            json!({"id":uuid::Uuid::new_v4().to_string(),"role":"user","text":text,"pending":true}),
        );
        let (cancel, mut cancelled) = watch::channel(false);
        self.commit(&entry, view, "message.submitted", &json!({}))
            .await?;
        *entry.cancel.lock().expect("cancel poisoned") = Some(cancel);
        drop(gate);
        let workbench = self.clone();
        let weak = Arc::downgrade(&entry);
        let operation = uuid::Uuid::new_v4().to_string();
        tokio::spawn(async move {
            let existing = entry
                .connection
                .lock()
                .expect("connection poisoned")
                .clone();
            let connected = if let Some(connection) = existing {
                Ok(connection)
            } else {
                let (provider, workspace) = {
                    let view = entry.view.lock().expect("view poisoned");
                    (view.provider.clone(), view.workspace.clone())
                };
                let descriptor = workbench
                    .providers
                    .iter()
                    .find(|value| value.id == provider)
                    .cloned()
                    .expect("validated provider");
                let sink_workbench = Arc::downgrade(&workbench);
                let sink = event_sink(move |event| {
                    let weak = weak.clone();
                    let parent = sink_workbench.clone();
                    async move {
                        if let (Some(entry), Some(workbench)) = (weak.upgrade(), parent.upgrade()) {
                            workbench.apply_event(&entry, event).await
                        } else {
                            Ok(())
                        }
                    }
                });
                tokio::select! {
                    result=AgentSession::connect(descriptor.command,descriptor.args,PathBuf::from(workspace),sink)=>result.map(Arc::new),
                    _=cancelled.changed()=>Err("启动已取消".into()),
                }
            };
            let result = match connected {
                Ok(connection) => {
                    *entry.connection.lock().expect("connection poisoned") =
                        Some(connection.clone());
                    if *cancelled.borrow() {
                        let _ = connection.cancel();
                        Err("执行已取消".into())
                    } else {
                        connection.prompt(&text).await.map(|_| ())
                    }
                }
                Err(error) => Err(error),
            };
            if let Err(error) = result {
                let _gate = entry.gate.lock().await;
                if workbench.stopping.load(Ordering::SeqCst) {
                    return;
                }
                entry.connection.lock().expect("connection poisoned").take();
                let mut view = entry.view.lock().expect("view poisoned").clone();
                view.active = false;
                view.approvals.clear();
                if *cancelled.borrow() {
                    view.status = "idle".into();
                    view.stop_reason = Some("cancelled".into())
                } else {
                    view.status = "disconnected".into();
                    view.error = Some(error.chars().take(4000).collect())
                }
                let _ = workbench
                    .commit(&entry, view, "run.failed", &json!({}))
                    .await;
            }
        });
        Ok(operation)
    }
    pub async fn cancel(&self, id: &str) -> Result<(), String> {
        self.available()?;
        let entry = self.entry(id)?;
        let _gate = entry.gate.lock().await;
        let mut view = entry.view.lock().expect("view poisoned").clone();
        if !view.active {
            return Ok(());
        }
        view.status = "cancelling".into();
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
            connection.cancel()?
        }
        Ok(())
    }
    pub async fn decide(&self, id: &str, request: &str, option: &str) -> Result<(), String> {
        self.available()?;
        let entry = self.entry(id)?;
        let _gate = entry.gate.lock().await;
        let mut view = entry.view.lock().expect("view poisoned").clone();
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
            .connection
            .lock()
            .expect("connection poisoned")
            .clone()
            .ok_or("Agent 未连接")?;
        // Durable submission audit is not a durable delivery/outbox implementation.
        self.commit(
            &entry,
            view,
            "approval.submitted",
            &json!({"requestId":request,"option":option}),
        )
        .await?;
        connection.decide(request, option)?;
        Ok(())
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
            if view.active {
                return Err("请先完成或停止运行中的会话".into());
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
            let _gate = entry.gate.lock().await;
            let mut view = entry.view.lock().expect("view poisoned").clone();
            if view.active {
                view.active = false;
                view.status = "interrupted".into();
                view.stop_reason = Some("interrupted".into());
                view.approvals.clear();
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
