use crate::{
    Activation, Error, HostCall, HostCapabilityBroker, InstanceGrant, InstanceKey, Result,
};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    path::Path,
    process::Stdio,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::Duration,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, Command},
    sync::{broadcast, mpsc, oneshot},
    task::{JoinHandle, JoinSet},
};

const MAX_FRAME: usize = 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(35);

#[derive(Default)]
struct Routing {
    pending: HashMap<String, oneshot::Sender<Result<Value>>>,
    instances: HashMap<InstanceKey, InstanceGrant>,
    invocations: HashMap<String, (InstanceKey, Option<String>)>,
}

struct State {
    child: Mutex<Option<Child>>,
    routing: Mutex<Routing>,
    closed: AtomicBool,
    outgoing: mpsc::Sender<Value>,
    events: broadcast::Sender<Value>,
}

impl State {
    fn close(&self, reason: &str) {
        self.closed.store(true, Ordering::SeqCst);
        let mut routing = self.routing.lock().expect("routing poisoned");
        for (_, sender) in routing.pending.drain() {
            let _ = sender.send(Err(Error::Closed(reason.into())));
        }
        routing.instances.clear();
        routing.invocations.clear();
        drop(routing);
        if let Some(child) = self.child.lock().expect("child poisoned").as_mut() {
            let _ = child.start_kill();
        }
    }

    fn authorize(&self, call: &HostCall) -> Result<()> {
        let routing = self.routing.lock().expect("routing poisoned");
        if self.closed.load(Ordering::SeqCst) {
            return Err(Error::Closed("worker unavailable".into()));
        }
        let grant = routing
            .instances
            .get(&call.instance)
            .ok_or_else(|| Error::Invalid("unknown instance".into()))?;
        if grant.plugin_id != call.plugin_id || !grant.capabilities.contains(&call.capability) {
            return Err(Error::Invalid("capability denied".into()));
        }
        if let Some(id) = &call.request_id {
            let parent = routing
                .invocations
                .get(id)
                .ok_or_else(|| Error::Invalid("parent invocation no longer exists".into()))?;
            if parent.0 != call.instance || parent.1 != call.workspace_id {
                return Err(Error::Invalid("parent invocation scope mismatch".into()));
            }
        } else if call.workspace_id.is_some() {
            return Err(Error::Invalid(
                "workspace access requires an invocation".into(),
            ));
        }
        if call
            .workspace_id
            .as_ref()
            .is_some_and(|workspace| !grant.workspaces.contains(workspace))
        {
            return Err(Error::Invalid("workspace denied".into()));
        }
        Ok(())
    }

    fn accept_progress(&self, event: &Value) -> bool {
        let Ok(key) = serde_json::from_value::<InstanceKey>(event.clone()) else {
            return false;
        };
        let Some(id) = event["requestId"].as_str() else {
            return false;
        };
        self.routing
            .lock()
            .expect("routing poisoned")
            .invocations
            .get(id)
            .is_some_and(|(parent, _)| parent == &key)
    }
}

/// Drops remove pending requests even if the calling Rust future is cancelled.
struct PendingGuard {
    id: String,
    state: Arc<State>,
}

struct ActivationGuard {
    key: InstanceKey,
    state: Arc<State>,
    committed: bool,
}

impl Drop for ActivationGuard {
    fn drop(&mut self) {
        if self.committed {
            return;
        }
        self.state
            .routing
            .lock()
            .expect("routing poisoned")
            .instances
            .remove(&self.key);
        let _ = self.state.outgoing.try_send(json!({
            "jsonrpc": "2.0", "method": "plugin/deactivate", "params": self.key
        }));
    }
}
impl Drop for PendingGuard {
    fn drop(&mut self) {
        let mut routing = self.state.routing.lock().expect("routing poisoned");
        routing.pending.remove(&self.id);
        if let Some((key, _)) = routing.invocations.remove(&self.id) {
            let _ = self.state.outgoing.try_send(json!({
                "jsonrpc": "2.0", "method": "plugin/cancel",
                "params": {"instanceId": key.instance_id, "generation": key.generation, "requestId": self.id}
            }));
        }
    }
}

pub struct PluginHost {
    state: Arc<State>,
    sequence: AtomicU64,
    tasks: Vec<JoinHandle<()>>,
}

impl PluginHost {
    pub async fn spawn(
        node: &Path,
        runner: &Path,
        broker: Arc<dyn HostCapabilityBroker>,
    ) -> Result<Self> {
        let mut child = Command::new(node)
            .arg(runner)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true)
            .spawn()?;
        let mut stdin = child.stdin.take().expect("piped stdin");
        let stdout = child.stdout.take().expect("piped stdout");
        let (outgoing, mut receiver) = mpsc::channel::<Value>(128);
        let (events, _) = broadcast::channel(256);
        let state = Arc::new(State {
            child: Mutex::new(Some(child)),
            routing: Mutex::new(Routing::default()),
            closed: AtomicBool::new(false),
            outgoing,
            events,
        });
        let writer_state = state.clone();
        let writer = tokio::spawn(async move {
            while let Some(message) = receiver.recv().await {
                let Ok(mut bytes) = serde_json::to_vec(&message) else {
                    break;
                };
                bytes.push(b'\n');
                if bytes.len() > MAX_FRAME || stdin.write_all(&bytes).await.is_err() {
                    break;
                }
            }
            writer_state.close("worker stdin closed");
        });
        let reader_state = state.clone();
        let reader = tokio::spawn(async move {
            let mut input = BufReader::new(stdout);
            let mut callbacks = JoinSet::new();
            loop {
                let frame = match read_frame(&mut input).await {
                    Ok(Some(frame)) => frame,
                    _ => break,
                };
                while callbacks.try_join_next().is_some() {}
                let Ok(message) = serde_json::from_slice::<Value>(&frame) else {
                    break;
                };
                if message["jsonrpc"] != "2.0" {
                    break;
                }
                if let Some(method) = message["method"].as_str() {
                    if method == "plugin/progress" {
                        if reader_state.accept_progress(&message["params"]) {
                            let _ = reader_state.events.send(message["params"].clone());
                        }
                    } else if method == "host/call" {
                        if callbacks.len() >= 128 {
                            let _ = reader_state
                                .outgoing
                                .send(rpc_error(&message["id"], "busy", "Too many host calls"))
                                .await;
                            continue;
                        }
                        let state = reader_state.clone();
                        let broker = broker.clone();
                        callbacks.spawn(async move {
                            let result = async {
                                let call: HostCall =
                                    serde_json::from_value(message["params"].clone())?;
                                state.authorize(&call)?;
                                tokio::time::timeout(Duration::from_secs(30), broker.call(call))
                                    .await
                                    .map_err(|_| Error::Timeout)?
                            }
                            .await;
                            let response = match result {
                                Ok(value) => {
                                    json!({"jsonrpc": "2.0", "id": message["id"], "result": value})
                                }
                                Err(error) => {
                                    rpc_error(&message["id"], "host_denied", &error.to_string())
                                }
                            };
                            let _ = state.outgoing.send(response).await;
                        });
                    } else {
                        break;
                    }
                } else if let Some(id) = message["id"].as_str() {
                    let sender = reader_state
                        .routing
                        .lock()
                        .expect("routing poisoned")
                        .pending
                        .remove(id);
                    if let Some(sender) = sender {
                        let result = if let Some(error) = message.get("error") {
                            Err(Error::Remote {
                                code: error["data"]["code"]
                                    .as_str()
                                    .unwrap_or("plugin_failed")
                                    .into(),
                                message: error["message"]
                                    .as_str()
                                    .unwrap_or("Worker failed")
                                    .into(),
                            })
                        } else if let Some(result) = message.get("result") {
                            Ok(result.clone())
                        } else {
                            Err(Error::Invalid("response has no result or error".into()))
                        };
                        let _ = sender.send(result);
                    }
                } else {
                    break;
                }
            }
            callbacks.abort_all();
            reader_state.close("worker stdout closed or invalid frame");
        });
        let host = Self {
            state,
            sequence: AtomicU64::new(0),
            tasks: vec![writer, reader],
        };
        let response = host
            .request("plugin/initialize", json!({"protocolVersion": 1}), None)
            .await?;
        if response["protocolVersion"] != 1 {
            return Err(Error::Invalid("unsupported protocol".into()));
        }
        Ok(host)
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Value> {
        self.state.events.subscribe()
    }

    async fn request(
        &self,
        method: &str,
        params: Value,
        invocation: Option<(InstanceKey, Option<String>)>,
    ) -> Result<Value> {
        if self.state.closed.load(Ordering::SeqCst) {
            return Err(Error::Closed("worker unavailable".into()));
        }
        let id = format!("host:{}", self.sequence.fetch_add(1, Ordering::SeqCst));
        let (sender, receiver) = oneshot::channel();
        {
            let mut routing = self.state.routing.lock().expect("routing poisoned");
            if self.state.closed.load(Ordering::SeqCst) {
                return Err(Error::Closed("worker unavailable".into()));
            }
            if routing.pending.len() >= 128 {
                return Err(Error::Invalid("too many pending requests".into()));
            }
            routing.pending.insert(id.clone(), sender);
            if let Some(invocation) = invocation {
                routing.invocations.insert(id.clone(), invocation);
            }
        }
        let _guard = PendingGuard {
            id: id.clone(),
            state: self.state.clone(),
        };
        let bytes = json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params});
        if serde_json::to_vec(&bytes)?.len() + 1 > MAX_FRAME {
            return Err(Error::Invalid("request exceeds frame limit".into()));
        }
        tokio::time::timeout(REQUEST_TIMEOUT, async {
            self.state
                .outgoing
                .send(bytes)
                .await
                .map_err(|_| Error::Closed("writer stopped".into()))?;
            receiver
                .await
                .map_err(|_| Error::Closed("reader stopped".into()))?
        })
        .await
        .map_err(|_| Error::Timeout)?
    }

    pub async fn activate(&self, activation: Activation) -> Result<Value> {
        let key = activation.grant.key.clone();
        if key.instance_id.is_empty()
            || key.generation == 0
            || key.generation > 9_007_199_254_740_991
        {
            return Err(Error::Invalid("invalid instance identity".into()));
        }
        {
            let mut routing = self.state.routing.lock().expect("routing poisoned");
            if routing.instances.contains_key(&key) {
                return Err(Error::Invalid("instance already exists".into()));
            }
            routing
                .instances
                .insert(key.clone(), activation.grant.clone());
        }
        let mut guard = ActivationGuard {
            key: key.clone(),
            state: self.state.clone(),
            committed: false,
        };
        let result = self
            .request(
                "plugin/activate",
                json!({
                    "instanceId": key.instance_id, "generation": key.generation,
                    "pluginId": activation.grant.plugin_id, "packagePath": activation.package_path,
                    "config": activation.config,
                }),
                None,
            )
            .await;
        guard.committed = result.is_ok();
        result
    }

    pub async fn invoke(
        &self,
        key: &InstanceKey,
        handler: &str,
        input: Value,
        workspace: Option<&str>,
        timeout: Duration,
    ) -> Result<Value> {
        {
            let routing = self.state.routing.lock().expect("routing poisoned");
            let grant = routing
                .instances
                .get(key)
                .ok_or_else(|| Error::Invalid("instance not activated".into()))?;
            if workspace.is_some_and(|id| !grant.workspaces.contains(id)) {
                return Err(Error::Invalid("workspace denied".into()));
            }
        }
        if timeout.as_millis() == 0 || timeout > Duration::from_secs(30) {
            return Err(Error::Invalid(
                "P0 invocation timeout must be 1ms..30s".into(),
            ));
        }
        let mut params = json!({"instanceId": key.instance_id, "generation": key.generation, "handler": handler, "input": input, "timeoutMs": timeout.as_millis()});
        if let Some(workspace) = workspace {
            params["workspaceId"] = json!(workspace);
        }
        // Enforce the budget outside Node too: synchronous plugin code can block its timers.
        tokio::time::timeout(
            timeout,
            self.request(
                "plugin/invoke",
                params,
                Some((key.clone(), workspace.map(str::to_owned))),
            ),
        )
        .await
        .map_err(|_| Error::Timeout)?
    }

    pub async fn deactivate(&self, key: &InstanceKey) -> Result<Value> {
        // Revoke new host calls immediately; no Worker-supplied identity can revive grants.
        self.state
            .routing
            .lock()
            .expect("routing poisoned")
            .instances
            .remove(key);
        self.request("plugin/deactivate", serde_json::to_value(key)?, None)
            .await
    }

    pub fn terminate(&self) -> Result<()> {
        self.state.close("worker terminated");
        if let Some(child) = self.state.child.lock().expect("child poisoned").as_mut() {
            child.start_kill()?;
        }
        Ok(())
    }

    pub async fn shutdown(mut self) -> Result<()> {
        let keys: Vec<_> = self
            .state
            .routing
            .lock()
            .expect("routing poisoned")
            .instances
            .keys()
            .cloned()
            .collect();
        let _ = tokio::time::timeout(Duration::from_secs(2), async {
            for key in keys {
                let _ = self.deactivate(&key).await;
            }
        })
        .await;
        self.terminate()?;
        for task in self.tasks.drain(..) {
            task.abort();
        }
        // The child is always reaped, including the explicit shutdown path.
        let child = self.state.child.lock().expect("child poisoned").take();
        if let Some(mut child) = child {
            child.wait().await?;
        }
        Ok(())
    }
}

impl Drop for PluginHost {
    fn drop(&mut self) {
        self.state.close("host dropped");
        for task in &self.tasks {
            task.abort();
        }
        // Child::kill_on_drop requests termination; Tokio performs background reaping.
    }
}

fn rpc_error(id: &Value, code: &str, message: &str) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "error": {"code": -32000, "message": message, "data": {"code": code}}})
}

/// Unlike read_line, this never buffers an unlimited unterminated frame.
async fn read_frame<R: tokio::io::AsyncBufRead + Unpin>(
    reader: &mut R,
) -> std::io::Result<Option<Vec<u8>>> {
    let mut frame = Vec::new();
    loop {
        let available = reader.fill_buf().await?;
        if available.is_empty() {
            return if frame.is_empty() {
                Ok(None)
            } else {
                Err(std::io::Error::other("unterminated frame"))
            };
        }
        let end = available.iter().position(|byte| *byte == b'\n');
        let count = end.map_or(available.len(), |end| end + 1);
        if frame.len() + count > MAX_FRAME {
            return Err(std::io::Error::other("frame too large"));
        }
        frame.extend_from_slice(&available[..count]);
        reader.consume(count);
        if end.is_some() {
            return Ok(Some(frame));
        }
    }
}
