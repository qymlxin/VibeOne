//! ACP v2 only. Transport lifecycle is owned by the official SDK, independently of Plugin RPC.
use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::v2::{ActiveSession, ConnectionTo, Responder, schema};
use agent_client_protocol::{AcpAgent, AcpAgentConfig, Agent, Client, Error};
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::sync::oneshot;

pub type Sink = Arc<dyn Fn(Value) + Send + Sync>;
struct Permission {
    options: HashSet<String>,
    reply: oneshot::Sender<Option<String>>,
}
type Permissions = Arc<Mutex<HashMap<String, Permission>>>;

struct LaunchGuard(Option<tokio::task::JoinHandle<()>>);
impl Drop for LaunchGuard {
    fn drop(&mut self) {
        if let Some(task) = &self.0 {
            task.abort();
        }
    }
}

pub struct AgentSession {
    session: ActiveSession<Agent>,
    permissions: Permissions,
    stop: Option<oneshot::Sender<()>>,
    task: tokio::task::JoinHandle<()>,
}

impl AgentSession {
    pub async fn connect(
        command: PathBuf,
        args: Vec<String>,
        cwd: PathBuf,
        sink: Sink,
    ) -> Result<Self, String> {
        let permissions: Permissions = Arc::default();
        let (ready_tx, ready_rx) = oneshot::channel();
        let ready = Arc::new(Mutex::new(Some(ready_tx)));
        let task_ready = ready.clone();
        let (stop_tx, stop_rx) = oneshot::channel();
        let pending = permissions.clone();
        let update_sink = sink.clone();
        let permission_sink = sink.clone();
        let task = tokio::spawn(async move {
            let result = Client
                .v2()
                .name("vibeone")
                .on_receive_notification(
                    async move |update: schema::UpdateSessionNotification,
                                _cx: ConnectionTo<Agent>| {
                        update_sink(json!({"type": "update", "notification": update}));
                        Ok(())
                    },
                    agent_client_protocol::on_receive_notification!(),
                )
                .on_receive_request(
                    async move |request: schema::RequestPermissionRequest,
                                responder: Responder<schema::RequestPermissionResponse>,
                                _cx: ConnectionTo<Agent>| {
                        let id = uuid::Uuid::new_v4().to_string();
                        let (tx, rx) = oneshot::channel();
                        {
                            let mut pending = pending.lock().expect("permissions poisoned");
                            if pending.len() >= 32 {
                                return responder.respond(schema::RequestPermissionResponse::new(
                                    schema::CancelledPermissionOutcome::new().into(),
                                ));
                            }
                            pending.insert(
                                id.clone(),
                                Permission {
                                    options: request
                                        .options
                                        .iter()
                                        .map(|option| option.option_id.to_string())
                                        .collect(),
                                    reply: tx,
                                },
                            );
                        }
                        permission_sink(
                            json!({"type": "permission", "id": id, "request": request}),
                        );
                        let cancellation = responder.cancellation().clone();
                        let selection = tokio::select! {
                            result = rx => result.ok().flatten(),
                            _ = cancellation.cancelled() => None,
                            _ = tokio::time::sleep(Duration::from_secs(600)) => None,
                        };
                        pending.lock().expect("permissions poisoned").remove(&id);
                        permission_sink(
                            json!({"type": "permission_resolved", "id": id, "selected": selection}),
                        );
                        let outcome = match selection {
                            Some(option) => schema::RequestPermissionOutcome::Selected(
                                schema::SelectedPermissionOutcome::new(
                                    schema::PermissionOptionId::new(option),
                                ),
                            ),
                            None => schema::CancelledPermissionOutcome::new().into(),
                        };
                        responder.respond(schema::RequestPermissionResponse::new(outcome))
                    },
                    agent_client_protocol::on_receive_request!(),
                )
                .connect_with(
                    AcpAgent::new(AcpAgentConfig::new(command).args(args)),
                    async move |cx| {
                        let init = cx
                            .send_request(schema::InitializeRequest::new(
                                ProtocolVersion::V2,
                                schema::Implementation::new("vibeone", env!("CARGO_PKG_VERSION")),
                            ))
                            .block_task()
                            .await?;
                        if init.capabilities.session.is_none() {
                            return Err(
                                Error::invalid_params().data("Agent 未声明 ACP v2 session 能力")
                            );
                        }
                        let opened = cx.build_session(cwd).start_session().block_task().await?;
                        if let Some(tx) = task_ready.lock().expect("ready poisoned").take() {
                            let _ = tx.send(Ok(opened.session.clone()));
                        }
                        let _ = stop_rx.await;
                        let _ = tokio::time::timeout(
                            Duration::from_secs(2),
                            opened.session.close().block_task(),
                        )
                        .await;
                        Ok(())
                    },
                )
                .await;
            let error = result.err().map(|error| error.to_string());
            if let Some(tx) = ready.lock().expect("ready poisoned").take() {
                let _ = tx.send(Err(error.clone().unwrap_or_else(|| "Agent 已断开".into())));
            }
            sink(json!({"type": "disconnected", "error": error}));
        });
        let mut launch = LaunchGuard(Some(task));
        match tokio::time::timeout(Duration::from_secs(30), ready_rx).await {
            Ok(Ok(Ok(session))) => Ok(Self {
                session,
                permissions,
                stop: Some(stop_tx),
                task: launch.0.take().expect("launch task"),
            }),
            result => Err(match result {
                Ok(Ok(Err(error))) => error,
                _ => "ACP v2 初始化失败或超时".into(),
            }),
        }
    }

    /// Acceptance is not completion: callers observe state_update notifications separately.
    pub async fn prompt(&self, text: &str) -> Result<Value, String> {
        tokio::time::timeout(
            Duration::from_secs(30),
            self.session.send_prompt(text).block_task(),
        )
        .await
        .map_err(|_| "Agent 接受输入超时".to_owned())?
        .map_err(|error| error.to_string())
        .and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string()))
    }

    pub fn cancel(&self) -> Result<(), String> {
        self.permissions
            .lock()
            .expect("permissions poisoned")
            .clear();
        self.session
            .cancel_active_work()
            .map_err(|error| error.to_string())
    }

    pub fn decide(&self, id: &str, option: &str) -> Result<(), String> {
        let mut pending = self.permissions.lock().expect("permissions poisoned");
        let permission = pending.get(id).ok_or("审批已失效或已处理")?;
        if !permission.options.contains(option) {
            return Err("选项不属于该审批请求".into());
        }
        pending
            .remove(id)
            .expect("checked permission")
            .reply
            .send(Some(option.into()))
            .map_err(|_| "审批已失效".into())
    }
}

impl Drop for AgentSession {
    fn drop(&mut self) {
        self.permissions
            .lock()
            .expect("permissions poisoned")
            .clear();
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
        // Permit the SDK's close + EOF + process-group shutdown path to run.
        let abort = self.task.abort_handle();
        if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            runtime.spawn(async move {
                tokio::time::sleep(Duration::from_secs(6)).await;
                abort.abort();
            });
        } else {
            self.task.abort();
        }
    }
}
