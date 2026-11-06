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
use vibeone_agent_client::AgentSession;
mod catalog;
mod execution;
use vibeone_storage::{SavedSession, Store, Workspace};

pub struct Entry {
    pub view: Mutex<SessionView>,
    gate: tokio::sync::Mutex<()>,
    revision: AtomicI64,
    connection: Mutex<Option<Arc<AgentSession>>>,
    cancel: Mutex<Option<watch::Sender<bool>>>,
    wake: tokio::sync::Notify,
    driver: AtomicBool,
    generation: AtomicU64,
}
impl Entry {
    fn new(view: SessionView, revision: i64) -> Arc<Self> {
        Arc::new(Self {
            view: Mutex::new(view),
            gate: tokio::sync::Mutex::new(()),
            revision: AtomicI64::new(revision),
            connection: Mutex::default(),
            cancel: Mutex::default(),
            wake: tokio::sync::Notify::new(),
            driver: AtomicBool::new(false),
            generation: AtomicU64::new(0),
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
            providers,
            sessions: Mutex::new(sessions),
            revision: AtomicU64::new(revision),
            events: broadcast::channel(128).0,
            store,
            workspaces: Mutex::new(workspaces),
            catalog_gate: tokio::sync::Mutex::new(()),
            publication: Mutex::new(()),
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
            if let Some(cancel) = entry.cancel.lock().expect("cancel poisoned").as_ref() {
                let _ = cancel.send(true);
            }
            if let Some(connection) = entry.connection.lock().expect("connection poisoned").take() {
                let _ = connection.cancel();
            }
            let mut view = entry.view.lock().expect("view poisoned");
            if view.active {
                view.active = false;
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
        json!({"protocolVersion":2,"sdkVersion":"5.0.0","persistent":true,"storageError":self.storage_error.lock().expect("storage error poisoned").clone(),"revision":self.revision.load(Ordering::SeqCst),"profiles":self.catalog("profile"),"providers":self.providers,"sessions":views,"workspaces":*self.workspaces.lock().expect("workspaces poisoned")})
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
        let profile = match profile_id {
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
            .connection
            .lock()
            .expect("connection poisoned")
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
            .connection
            .lock()
            .expect("connection poisoned")
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
            if view.active || !view.queue.is_empty() {
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
