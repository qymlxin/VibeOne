use crate::{files, providers::find_node, state::Workbench};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, Weak},
    time::Duration,
};
use vibeone_plugin_host::{
    Activation, Error, HostCall, HostCapabilityBroker, HostFuture, InstanceGrant, InstanceKey,
    PluginHost, PluginLease, PluginManager,
};

struct Broker(Weak<Workbench>);
impl HostCapabilityBroker for Broker {
    fn call(&self, call: HostCall) -> HostFuture<'_> {
        Box::pin(async move {
            let workbench = self
                .0
                .upgrade()
                .ok_or_else(|| Error::Closed("Host stopped".into()))?;
            let snapshot = workbench.snapshot();
            let workspace = snapshot["workspaces"]
                .as_array()
                .and_then(|items| {
                    items.iter().find(|item| {
                        Some(item["id"].as_str().unwrap_or_default())
                            == call.workspace_id.as_deref()
                    })
                })
                .ok_or_else(|| Error::Invalid("workspace is not authorized".into()))?;
            let path = workspace["path"]
                .as_str()
                .ok_or_else(|| Error::Invalid("workspace missing".into()))?;
            let relative = call.input["path"].as_str().unwrap_or(".");
            let result = match (call.capability.as_str(), call.operation.as_str()) {
                ("workspace.read", "scan") => files::tree(path, relative)
                    .await
                    .map_err(|error| error.to_string()),
                ("workspace.read", "read") => files::read(path, relative)
                    .await
                    .map_err(|error| error.to_string()),
                ("notifications.send", "show") => {
                    let message = call.input["message"]
                        .as_str()
                        .ok_or_else(|| Error::Invalid("notification message missing".into()))?;
                    if message.chars().count() > 1000 {
                        return Err(Error::Invalid("notification too long".into()));
                    }
                    let id = call.input["idempotencyKey"]
                        .as_str()
                        .filter(|key| !key.is_empty() && key.len() <= 128)
                        .map(|key| format!("{}:{key}", call.plugin_id))
                        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
                    workbench.put_catalog("notification",&id,json!({"id":id,"message":message,"pluginId":call.plugin_id,"workspaceId":call.workspace_id})).await.map(|_|json!({"shown":true}))
                }
                _ => Err("插件宿主操作未授权或不支持".into()),
            };
            result.map_err(Error::Invalid)
        })
    }
}
struct Candidate {
    record: Value,
    manager: Arc<PluginManager>,
    base: u64,
    created: std::time::Instant,
}
pub(crate) struct PreparedInvocation {
    lease: PluginLease,
    pub(crate) title: String,
    pub(crate) plugin_name: String,
    handler: String,
    input: Value,
    workspace: Option<String>,
}
impl PreparedInvocation {
    pub(crate) fn generation(&self) -> u64 {
        self.lease.key().generation
    }
    pub(crate) async fn execute(self) -> Result<Value, String> {
        self.lease
            .invoke(
                &self.handler,
                self.input,
                self.workspace.as_deref(),
                Duration::from_secs(30),
            )
            .await
            .map_err(|error| error.to_string())
    }
}
pub(crate) struct Plugins {
    directory: PathBuf,
    current: Mutex<HashMap<String, Arc<PluginManager>>>,
    pending: Mutex<HashMap<String, Candidate>>,
    gate: tokio::sync::Mutex<()>,
    events: Mutex<Vec<Value>>,
}
fn copy_package(source: &Path, destination: &Path) -> Result<(), String> {
    fn walk(
        source: &Path,
        destination: &Path,
        count: &mut usize,
        total: &mut u64,
    ) -> Result<(), String> {
        std::fs::create_dir_all(destination).map_err(|error| error.to_string())?;
        for entry in std::fs::read_dir(source).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let name = entry.file_name();
            if matches!(name.to_str(), Some("node_modules" | ".git" | "target")) {
                continue;
            }
            let kind = entry.file_type().map_err(|error| error.to_string())?;
            if kind.is_symlink() {
                return Err("插件包不能包含符号链接，请构建独立安装目录".into());
            }
            *count += 1;
            if *count > 5000 {
                return Err("插件包文件数量超过限制".into());
            }
            if kind.is_dir() {
                walk(&entry.path(), &destination.join(&name), count, total)?;
            } else if kind.is_file() {
                *total += entry.metadata().map_err(|error| error.to_string())?.len();
                if *total > 20 * 1024 * 1024 {
                    return Err("插件包超过 20 MiB，请移除构建缓存".into());
                }
                std::fs::copy(entry.path(), destination.join(&name))
                    .map_err(|error| error.to_string())?;
            }
        }
        Ok(())
    }
    walk(source, destination, &mut 0, &mut 0)
}
pub(crate) fn inspect(path: &Path) -> Result<Value, String> {
    let file = files::resolve(path, "plugin.json", false).map_err(|error| error.to_string())?;
    if std::fs::metadata(&file)
        .map_err(|error| error.to_string())?
        .len()
        > 65536
    {
        return Err("插件清单过大".into());
    }
    let manifest: Value =
        serde_json::from_slice(&std::fs::read(file).map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?;
    let id = manifest["id"].as_str().ok_or("插件缺少 id")?;
    if id.is_empty()
        || id.len() > 128
        || !id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || "._-".contains(ch))
    {
        return Err("插件 id 无效".into());
    }
    if manifest["manifestVersion"] != 1 || manifest["engines"]["pluginApi"] != ">=0.1 <0.2" {
        return Err("插件 API 版本不兼容".into());
    }
    if manifest["entrypoints"].get("worker").is_some() {
        files::resolve(
            path,
            manifest["entrypoints"]["worker"]["path"]
                .as_str()
                .ok_or("缺少 Worker 入口")?,
            false,
        )
        .map_err(|error| error.to_string())?;
    }
    if let Some(app) = manifest["entrypoints"].get("app") {
        files::resolve(path, app["path"].as_str().ok_or("缺少 App 入口")?, false)
            .map_err(|error| error.to_string())?;
    }
    let mut ids = std::collections::HashSet::new();
    for item in manifest["contributions"]
        .as_array()
        .ok_or("插件缺少扩展点声明")?
    {
        let id = item["id"].as_str().ok_or("扩展点缺少 id")?;
        if !ids.insert(id) || item["kindVersion"] != 1 {
            return Err("扩展点重复或版本不兼容".into());
        }
        let supported = match item["kind"].as_str() {
            Some("app.panel" | "settings.section") => item["binding"]["type"] == "app",
            Some("app.command") => {
                matches!(item["binding"]["type"].as_str(), Some("app" | "worker"))
            }
            Some("agent.provider") => {
                item["binding"]["type"] == "declarative"
                    && item["binding"]["descriptor"]["command"].is_string()
            }
            Some("notification.channel") => item["binding"]["type"] == "worker",
            _ => false,
        };
        if !supported {
            return Err(format!("当前版本不支持此扩展点或绑定：{id}"));
        }
        if item["kind"] == "agent.provider" {
            if !manifest["hostRequirements"]
                .as_array()
                .is_some_and(|caps| caps.iter().any(|cap| cap == "agent.spawn"))
            {
                return Err("Agent Provider 必须声明 agent.spawn 权限".into());
            }
            let descriptor = &item["binding"]["descriptor"];
            let command = descriptor["command"].as_str().unwrap_or_default();
            if command.is_empty()
                || command != "$node"
                    && !std::path::Path::new(command).is_absolute()
                    && !files::resolve(path, command, false)
                        .map_err(|error| error.to_string())?
                        .is_file()
            {
                return Err("Provider 启动程序不存在".into());
            }
            if let Some(args) = descriptor.get("args")
                && !args.as_array().is_some_and(|args| {
                    args.len() <= 64
                        && args.iter().all(|arg| {
                            arg.as_str().is_some_and(|text| {
                                text.len() <= 4096
                                    && !text.strip_prefix("$package/").is_some_and(|path| {
                                        std::path::Path::new(path).is_absolute()
                                            || std::path::Path::new(path)
                                                .components()
                                                .any(|part| part == std::path::Component::ParentDir)
                                    })
                            })
                        })
                })
            {
                return Err("Provider 启动参数或包内路径无效".into());
            }
        }
    }
    if let Some(dependencies) = manifest["dependencies"].as_object()
        && !dependencies.is_empty()
    {
        return Err("当前版本要求插件自包含；请打包依赖后安装".into());
    }
    Ok(manifest)
}
impl Plugins {
    pub fn new(directory: PathBuf) -> Self {
        Self {
            directory,
            current: Mutex::default(),
            pending: Mutex::default(),
            gate: tokio::sync::Mutex::new(()),
            events: Mutex::default(),
        }
    }
    pub fn events(&self) -> Vec<Value> {
        self.events.lock().expect("plugin events poisoned").clone()
    }
    fn runtime(&self) -> PathBuf {
        std::env::var_os("VIBEONE_RUNTIME_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages"))
            .join("plugin-runtime/dist/main.js")
    }
    async fn activate(
        &self,
        workbench: &Arc<Workbench>,
        record: &Value,
    ) -> Result<Arc<PluginManager>, String> {
        let runtime = self.runtime();
        let sdk = runtime
            .parent()
            .and_then(Path::parent)
            .and_then(Path::parent)
            .ok_or("插件运行时路径无效")?
            .join("plugin-sdk");
        let destination = self.directory.join("node_modules/@vibeone/plugin-sdk");
        if !destination.exists() {
            copy_package(&sdk, &destination)?;
        }
        let node = find_node().ok_or("未找到 Node.js 22+，请安装后重试")?;
        let host = PluginHost::spawn(&node, &runtime, Arc::new(Broker(Arc::downgrade(workbench))))
            .await
            .map_err(|error| error.to_string())?;
        let mut progress = host.subscribe();
        let weak = Arc::downgrade(workbench);
        let id = record["id"].clone();
        let generation = record["generation"].clone();
        tokio::spawn(async move {
            while let Ok(event) = progress.recv().await {
                let Some(workbench) = weak.upgrade() else {
                    break;
                };
                let message = json!({"pluginId":id,"generation":generation,"text":event.to_string().chars().take(4000).collect::<String>()});
                {
                    let mut events = workbench
                        .plugins
                        .events
                        .lock()
                        .expect("plugin events poisoned");
                    events.push(message);
                    if events.len() > 100 {
                        events.remove(0);
                    }
                }
                let _ = workbench.events.send(0);
            }
        });
        let manager = Arc::new(PluginManager::new(Arc::new(host)));
        manager
            .replace(Activation {
                package_path: PathBuf::from(record["path"].as_str().ok_or("插件路径无效")?),
                grant: InstanceGrant {
                    key: InstanceKey {
                        instance_id: record["id"].as_str().unwrap_or_default().into(),
                        generation: record["generation"].as_u64().unwrap_or(1),
                    },
                    plugin_id: record["id"].as_str().unwrap_or_default().into(),
                    capabilities: record["capabilities"]
                        .as_array()
                        .map(|items| {
                            items
                                .iter()
                                .filter_map(|item| item.as_str().map(str::to_owned))
                                .collect()
                        })
                        .unwrap_or_default(),
                    workspaces: record["workspaces"]
                        .as_array()
                        .map(|items| {
                            items
                                .iter()
                                .filter_map(|item| item.as_str().map(str::to_owned))
                                .collect()
                        })
                        .unwrap_or_default(),
                },
                config: record["config"].clone(),
            })
            .await
            .map_err(|error| error.to_string())?;
        Ok(manager)
    }
    pub async fn restore(&self, workbench: &Arc<Workbench>) {
        for mut record in workbench.catalog("plugin") {
            if record["enabled"] != true {
                continue;
            }
            match self.activate(workbench, &record).await {
                Ok(manager) => {
                    self.current
                        .lock()
                        .expect("plugins poisoned")
                        .insert(record["id"].as_str().unwrap_or_default().into(), manager);
                }
                Err(error) => {
                    record["enabled"] = json!(false);
                    record["error"] = json!(error);
                    let id = record["id"].as_str().unwrap_or_default().to_owned();
                    let _ = workbench.put_catalog("plugin", &id, record).await;
                }
            }
        }
    }
    pub async fn prepare(&self, workbench: &Arc<Workbench>, body: Value) -> Result<Value, String> {
        let _gate = self.gate.lock().await;
        if body["trusted"] != true {
            return Err("请先确认信任本地插件代码与声明权限".into());
        }
        self.pending
            .lock()
            .expect("plugins poisoned")
            .retain(|_, candidate| candidate.created.elapsed() < Duration::from_secs(600));
        if self.pending.lock().expect("plugins poisoned").len() >= 8 {
            return Err("有过多待确认的插件更新，请先完成或取消".into());
        }
        let source = PathBuf::from(body["path"].as_str().ok_or("请选择插件目录")?)
            .canonicalize()
            .map_err(|_| "插件目录不存在")?;
        let mut manifest = inspect(&source)?;
        if body.get("expectedManifest").is_some() && body["expectedManifest"] != manifest {
            return Err("插件清单已变化，请重新检查并授权".into());
        }
        let id = manifest["id"].as_str().unwrap_or_default().to_owned();
        if workbench.catalog("plugin").len() >= 64
            && !workbench
                .catalog("plugin")
                .iter()
                .any(|record| record["id"] == id)
        {
            return Err("本地插件数量已达到当前版本上限".into());
        }
        let capabilities = manifest["hostRequirements"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        if !capabilities.iter().all(|item| {
            matches!(
                item.as_str(),
                Some("workspace.read" | "notifications.send" | "agent.spawn")
            )
        }) {
            return Err("插件声明了当前宿主不支持的权限".into());
        }
        let workspaces = body["workspaces"].as_array().cloned().unwrap_or_default();
        let known = workbench.snapshot()["workspaces"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        if !workspaces
            .iter()
            .all(|id| known.iter().any(|workspace| workspace["id"] == *id))
        {
            return Err("插件工作区授权无效".into());
        }
        if !body["config"].is_null() && !body["config"].is_object() {
            return Err("插件配置须为 JSON 对象".into());
        }
        if let Some(schema) = manifest.get("configurationSchema") {
            let validator = jsonschema::validator_for(schema).map_err(|error| error.to_string())?;
            validator
                .validate(&body.get("config").cloned().unwrap_or_else(|| json!({})))
                .map_err(|error| format!("插件配置不符合要求：{error}"))?;
        }
        let ticket = uuid::Uuid::new_v4().to_string();
        let destination = self.directory.join("plugins").join(&id).join(&ticket);
        if source.starts_with(&destination) || destination.starts_with(&source) {
            return Err("插件源目录不能包含安装目录".into());
        }
        let from = source.clone();
        let to = destination.clone();
        tokio::task::spawn_blocking(move || copy_package(&from, &to))
            .await
            .map_err(|error| error.to_string())??;
        if manifest["entrypoints"].get("worker").is_none() {
            manifest["entrypoints"]["worker"] =
                json!({"path":"vibeone-noop.mjs","runtime":"node","protocolVersion":1});
            tokio::fs::write(
                destination.join("vibeone-noop.mjs"),
                "export default {apiVersion:'0.1',setup(){}};",
            )
            .await
            .map_err(|error| error.to_string())?;
            tokio::fs::write(
                destination.join("plugin.json"),
                serde_json::to_vec(&manifest).map_err(|error| error.to_string())?,
            )
            .await
            .map_err(|error| error.to_string())?;
        }
        let old = workbench
            .catalog("plugin")
            .into_iter()
            .find(|record| record["id"] == id);
        let base = old
            .as_ref()
            .and_then(|record| record["generation"].as_u64())
            .unwrap_or(0);
        let record = json!({"id":id,"name":manifest["name"],"version":manifest["version"],"manifest":manifest,"path":destination,"generation":base+1,"enabled":true,"capabilities":capabilities,"workspaces":workspaces,"config":body["config"].as_object().cloned().unwrap_or_default(),"error":null});
        let manager = match self.activate(workbench, &record).await {
            Ok(manager) => manager,
            Err(error) => {
                let _ = tokio::fs::remove_dir_all(destination).await;
                return Err(error);
            }
        };
        let app = Self::app(&record)?;
        self.pending.lock().expect("plugins poisoned").insert(
            ticket.clone(),
            Candidate {
                record: record.clone(),
                manager,
                base,
                created: std::time::Instant::now(),
            },
        );
        Ok(json!({"ticket":ticket,"plugin":record,"app":app}))
    }
    pub fn app(record: &Value) -> Result<Value, String> {
        let Some(path) = record["manifest"]["entrypoints"]["app"]["path"].as_str() else {
            return Ok(Value::Null);
        };
        let file = files::resolve(
            Path::new(record["path"].as_str().ok_or("插件路径无效")?),
            path,
            false,
        )
        .map_err(|error| error.to_string())?;
        if std::fs::metadata(&file)
            .map_err(|error| error.to_string())?
            .len()
            > 1024 * 1024
        {
            return Err("App 入口须为不超过 1 MiB 的单文件 ESM".into());
        }
        std::fs::read_to_string(file)
            .map(|source| json!({"source":source}))
            .map_err(|error| error.to_string())
    }
    pub async fn commit(&self, workbench: &Workbench, ticket: &str) -> Result<Value, String> {
        let _gate = self.gate.lock().await;
        let candidate = self
            .pending
            .lock()
            .expect("plugins poisoned")
            .remove(ticket)
            .ok_or("插件候选已失效")?;
        let id = candidate.record["id"].as_str().ok_or("插件 id 无效")?;
        let current = workbench
            .catalog("plugin")
            .iter()
            .find(|record| record["id"] == id)
            .and_then(|record| record["generation"].as_u64())
            .unwrap_or(0);
        if current != candidate.base {
            return Err("插件已在其他窗口更新，请重新加载候选".into());
        }
        workbench
            .put_catalog("plugin", id, candidate.record.clone())
            .await?;
        self.current
            .lock()
            .expect("plugins poisoned")
            .insert(id.into(), candidate.manager);
        Ok(candidate.record)
    }
    pub fn discard(&self, ticket: &str) {
        self.pending
            .lock()
            .expect("plugins poisoned")
            .remove(ticket);
    }
    pub async fn disable(&self, workbench: &Workbench, id: &str) -> Result<(), String> {
        let _gate = self.gate.lock().await;
        let mut record = workbench
            .catalog("plugin")
            .into_iter()
            .find(|record| record["id"] == id)
            .ok_or("插件不存在")?;
        record["enabled"] = json!(false);
        workbench.put_catalog("plugin", id, record).await?;
        self.current.lock().expect("plugins poisoned").remove(id);
        Ok(())
    }
    pub async fn deliver_notification(
        &self,
        workbench: &Workbench,
        event: &Value,
    ) -> Result<(), String> {
        let snapshot = workbench.snapshot();
        let workspace = snapshot["workspaces"]
            .as_array()
            .and_then(|items| {
                items
                    .iter()
                    .find(|workspace| workspace["path"] == event["workspace"])
            })
            .and_then(|workspace| workspace["id"].as_str())
            .ok_or("通知工作区不存在")?
            .to_owned();
        let mut deliveries = vec![];
        for record in workbench.catalog("plugin").into_iter().filter(|record| {
            record["enabled"] == true
                && record["workspaces"]
                    .as_array()
                    .is_some_and(|items| items.iter().any(|item| item == &workspace))
        }) {
            for contribution in record["manifest"]["contributions"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .filter(|item| {
                    item["kind"] == "notification.channel" && item["binding"]["type"] == "worker"
                })
            {
                let Some(handler) = contribution["binding"]["handler"]
                    .as_str()
                    .map(str::to_owned)
                else {
                    continue;
                };
                let lease = self.acquire(record["id"].as_str().unwrap_or_default())?;
                if Some(lease.key().generation) != record["generation"].as_u64() {
                    return Err("通知插件正在更新".into());
                }
                let mut payload = event.clone();
                payload["workspaceId"] = json!(workspace);
                let workspace = workspace.clone();
                deliveries.push(async move {
                    lease
                        .invoke(&handler, payload, Some(&workspace), Duration::from_secs(2))
                        .await
                        .map(|_| ())
                        .map_err(|error| error.to_string())
                });
            }
        }
        for result in futures_util::future::join_all(deliveries).await {
            result?;
        }
        Ok(())
    }
    pub fn acquire(&self, id: &str) -> Result<vibeone_plugin_host::PluginLease, String> {
        self.current
            .lock()
            .expect("plugins poisoned")
            .get(id)
            .ok_or("Provider 插件未启用")?
            .acquire(id)
            .map_err(|error| error.to_string())
    }
    pub async fn invoke(
        &self,
        workbench: &Workbench,
        id: &str,
        body: Value,
    ) -> Result<Value, String> {
        let prepared = self.prepare_invocation(workbench, id, &body).await?;
        let generation = prepared.generation();
        let result = prepared.execute().await;
        if let Err(error) = &result {
            let _gate = self.gate.lock().await;
            if let Some(mut current) = workbench
                .catalog("plugin")
                .into_iter()
                .find(|record| record["id"] == id && record["generation"] == generation)
            {
                current["error"] = json!(error.chars().take(2000).collect::<String>());
                let _ = workbench.put_catalog("plugin", id, current).await;
            }
        }
        result
    }
    pub(crate) async fn prepare_invocation(
        &self,
        workbench: &Workbench,
        id: &str,
        body: &Value,
    ) -> Result<PreparedInvocation, String> {
        let gate = self.gate.lock().await;
        let manager = self
            .current
            .lock()
            .expect("plugins poisoned")
            .get(id)
            .cloned()
            .ok_or("插件未启用")?;
        let record = workbench
            .catalog("plugin")
            .into_iter()
            .find(|record| record["id"] == id)
            .ok_or("插件未安装")?;
        if let Some(generation) = body["generation"].as_u64()
            && Some(generation) != record["generation"].as_u64()
        {
            return Err("插件代次已变化，请刷新界面".into());
        }
        let handler = body["handler"].as_str().ok_or("缺少处理器")?;
        if !record["manifest"]["contributions"]
            .as_array()
            .is_some_and(|items| {
                items.iter().any(|item| {
                    item["binding"]["type"] == "worker" && item["binding"]["handler"] == handler
                })
            })
        {
            return Err("处理器未通过清单公开".into());
        }
        let workspace = body["workspaceId"].as_str();
        if let Some(workspace) = workspace
            && !record["workspaces"]
                .as_array()
                .is_some_and(|items| items.iter().any(|item| item == workspace))
        {
            return Err("插件未获授权访问此工作区".into());
        }
        let lease = manager.acquire(id).map_err(|error| error.to_string())?;
        if Some(lease.key().generation) != record["generation"].as_u64() {
            return Err("插件代次正在切换，请稍后重试".into());
        }
        drop(gate);
        let title = record["manifest"]["contributions"]
            .as_array()
            .and_then(|items| {
                items
                    .iter()
                    .find(|item| item["binding"]["handler"] == handler)
            })
            .and_then(|item| item["title"].as_str())
            .unwrap_or(handler)
            .to_owned();
        Ok(PreparedInvocation {
            title,
            plugin_name: record["name"].as_str().unwrap_or(id).to_owned(),
            lease,
            handler: handler.into(),
            input: body["input"].clone(),
            workspace: workspace.map(str::to_owned),
        })
    }
}
