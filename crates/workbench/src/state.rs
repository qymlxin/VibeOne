use crate::{projection::SessionView, providers::Provider};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        Arc, Mutex, Weak,
        atomic::{AtomicU64, Ordering},
    },
};
use tokio::sync::{broadcast, watch};
use vibeone_agent_client::AgentSession;

pub struct Entry {
    pub view: Mutex<SessionView>,
    connection: Mutex<Option<Arc<AgentSession>>>,
    cancel: Mutex<Option<watch::Sender<bool>>>,
}
pub struct Workbench {
    pub providers: Vec<Provider>,
    pub sessions: Mutex<HashMap<String, Arc<Entry>>>,
    pub revision: AtomicU64,
    pub events: broadcast::Sender<u64>,
}

impl Workbench {
    pub fn new(providers: Vec<Provider>) -> Arc<Self> {
        Arc::new(Self {
            providers,
            sessions: Mutex::default(),
            revision: AtomicU64::new(0),
            events: broadcast::channel(128).0,
        })
    }
    pub fn changed(&self) {
        let revision = self.revision.fetch_add(1, Ordering::SeqCst) + 1;
        let _ = self.events.send(revision);
    }
    pub fn snapshot(&self) -> Value {
        let sessions = self.sessions.lock().expect("sessions poisoned");
        let mut views: Vec<_> = sessions
            .values()
            .map(|entry| entry.view.lock().expect("view poisoned").clone())
            .collect();
        views.sort_by(|a, b| a.id.cmp(&b.id));
        json!({"protocolVersion":2,"sdkVersion":"5.0.0","revision":self.revision.load(Ordering::SeqCst),"providers":self.providers,"sessions":views})
    }
    pub fn entry(&self, id: &str) -> Result<Arc<Entry>, String> {
        self.sessions
            .lock()
            .expect("sessions poisoned")
            .get(id)
            .cloned()
            .ok_or("会话不存在".into())
    }
    pub fn create(&self, provider: &str, workspace: &str) -> Result<String, String> {
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
        let mut sessions = self.sessions.lock().expect("sessions poisoned");
        if sessions.len() >= 32 {
            return Err("本次主机最多保留 32 个会话，请重启主机清理".into());
        }
        let id = uuid::Uuid::new_v4().to_string();
        sessions.insert(
            id.clone(),
            Arc::new(Entry {
                view: Mutex::new(SessionView {
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
                }),
                connection: Mutex::default(),
                cancel: Mutex::default(),
            }),
        );
        drop(sessions);
        self.changed();
        Ok(id)
    }
    pub fn submit(self: &Arc<Self>, id: &str, text: String) -> Result<String, String> {
        if text.trim().is_empty() || text.len() > 32_768 {
            return Err("输入不能为空且不能超过 32 KiB".into());
        }
        let entry = self.entry(id)?;
        {
            let mut view = entry.view.lock().expect("view poisoned");
            if view.active {
                return Err("当前轮次尚未结束，请等待或先停止".into());
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
            view.messages.push(json!({"id":uuid::Uuid::new_v4().to_string(),"role":"user","text":text,"pending":true}));
        }
        let (cancel, mut cancelled) = watch::channel(false);
        *entry.cancel.lock().expect("cancel poisoned") = Some(cancel);
        self.changed();
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
                let (provider_id, workspace) = {
                    let view = entry.view.lock().expect("view poisoned");
                    (view.provider.clone(), view.workspace.clone())
                };
                let descriptor = workbench
                    .providers
                    .iter()
                    .find(|candidate| candidate.id == provider_id)
                    .cloned()
                    .expect("validated provider");
                let sink_workbench = Arc::downgrade(&workbench);
                let sink = Arc::new(move |event: Value| {
                    if let Some(entry) = Weak::upgrade(&weak) {
                        entry.view.lock().expect("view poisoned").apply(&event)
                    }
                    if let Some(workbench) = Weak::upgrade(&sink_workbench) {
                        workbench.changed()
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
                entry.connection.lock().expect("connection poisoned").take();
                let mut view = entry.view.lock().expect("view poisoned");
                view.active = false;
                view.approvals.clear();
                if *cancelled.borrow() {
                    view.status = "idle".into();
                    view.stop_reason = Some("cancelled".into());
                } else {
                    view.status = "disconnected".into();
                    view.error = Some(error.chars().take(4000).collect());
                }
                drop(view);
                workbench.changed();
            }
        });
        Ok(operation)
    }
    pub fn cancel(&self, id: &str) -> Result<(), String> {
        let entry = self.entry(id)?;
        if !entry.view.lock().expect("view poisoned").active {
            return Ok(());
        }
        entry.view.lock().expect("view poisoned").status = "cancelling".into();
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
        self.changed();
        Ok(())
    }
    pub fn decide(&self, id: &str, request: &str, option: &str) -> Result<(), String> {
        let entry = self.entry(id)?;
        let connection = entry
            .connection
            .lock()
            .expect("connection poisoned")
            .clone()
            .ok_or("Agent 未连接")?;
        connection.decide(request, option)?;
        self.changed();
        Ok(())
    }
    pub fn stop(&self) {
        for entry in self.sessions.lock().expect("sessions poisoned").values() {
            if let Some(cancel) = entry.cancel.lock().expect("cancel poisoned").as_ref() {
                let _ = cancel.send(true);
            }
            if let Some(connection) = entry.connection.lock().expect("connection poisoned").take() {
                let _ = connection.cancel();
            }
        }
    }
}
