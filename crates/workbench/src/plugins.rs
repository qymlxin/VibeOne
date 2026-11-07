use crate::domain_error::{DomainError, ErrorKind};
mod resources;
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
    pub(crate) async fn execute(self) -> Result<Value, DomainError> {
        self.lease
            .invoke(
                &self.handler,
                self.input,
                self.workspace.as_deref(),
                Duration::from_secs(30),
            )
            .await
            .map_err(|error| worker_error(error, ErrorKind::PluginOperationFailed))
    }
}
pub(crate) struct Plugins {
    directory: PathBuf,
    current: Mutex<HashMap<String, Arc<PluginManager>>>,
    pending: Mutex<HashMap<String, Candidate>>,
    gate: tokio::sync::Mutex<()>,
    events: Mutex<Vec<Value>>,
}
fn plugin_failure(kind: ErrorKind, message: &str) -> DomainError {
    DomainError::new(kind, message)
}
fn worker_error(error: Error, fallback: ErrorKind) -> DomainError {
    let kind = match error {
        Error::Timeout => ErrorKind::PluginTimeout,
        Error::Closed(_) | Error::Io(_) => ErrorKind::PluginUnavailable,
        _ => fallback,
    };
    let message = match kind {
        ErrorKind::PluginTimeout => "插件请求超时，请核对已经发生的动作",
        ErrorKind::PluginUnavailable => "插件运行连接不可用，执行结果可能未确认",
        ErrorKind::PluginActivationFailed => "插件激活失败，请检查入口及运行环境",
        _ => "插件操作执行失败，请检查插件运行状态",
    };
    plugin_failure(kind, message)
}
fn copy_package(source: &Path, destination: &Path) -> Result<(), DomainError> {
    use std::io::{Read, Write};
    let io_error = |_| {
        plugin_failure(
            ErrorKind::PluginUnavailable,
            "插件包复制失败，请检查目录和访问权限",
        )
    };
    fn walk(
        source: &cap_std::fs::Dir,
        destination: &cap_std::fs::Dir,
        count: &mut usize,
        total: &mut u64,
        depth: usize,
    ) -> Result<(), DomainError> {
        let io_error = |_| {
            plugin_failure(
                ErrorKind::PluginUnavailable,
                "插件包复制失败，请检查目录和访问权限",
            )
        };
        if depth > 64 {
            return Err(invalid_manifest("插件包目录嵌套超过64层"));
        }
        for entry in source.entries().map_err(io_error)? {
            let entry = entry.map_err(io_error)?;
            let name = entry.file_name();
            if matches!(name.to_str(), Some("node_modules" | ".git" | "target")) {
                continue;
            }
            let kind = entry.file_type().map_err(io_error)?;
            if kind.is_symlink() {
                return Err(invalid_manifest(
                    "插件包不能包含符号链接，请构建独立安装目录",
                ));
            }
            *count += 1;
            if *count > 5000 {
                return Err(invalid_manifest("插件包文件数量超过限制"));
            }
            if kind.is_dir() {
                destination.create_dir(&name).map_err(io_error)?;
                walk(
                    &source.open_dir(&name).map_err(io_error)?,
                    &destination.open_dir(&name).map_err(io_error)?,
                    count,
                    total,
                    depth + 1,
                )?;
            } else if kind.is_file() {
                let mut options = cap_std::fs::OpenOptions::new();
                options.read(true);
                #[cfg(unix)]
                {
                    use cap_std::fs::OpenOptionsExt;
                    options.custom_flags(rustix::fs::OFlags::NONBLOCK.bits() as i32);
                }
                let input = source.open_with(&name, &options).map_err(io_error)?;
                let metadata = input.metadata().map_err(io_error)?;
                if !metadata.is_file() {
                    return Err(invalid_manifest("插件包只能包含普通文件和目录"));
                }
                let remaining = 20 * 1024 * 1024 - *total;
                let too_large = || {
                    plugin_failure(
                        ErrorKind::PluginResourceTooLarge,
                        "插件包超过20MiB，请移除构建缓存",
                    )
                };
                if metadata.len() > remaining {
                    return Err(too_large());
                }
                let mut bytes = Vec::new();
                input
                    .take(remaining + 1)
                    .read_to_end(&mut bytes)
                    .map_err(io_error)?;
                if bytes.len() as u64 > remaining {
                    return Err(too_large());
                }
                *total += bytes.len() as u64;
                let mut output = destination.create(&name).map_err(io_error)?;
                output.write_all(&bytes).map_err(io_error)?;
                output
                    .set_permissions(metadata.permissions())
                    .map_err(io_error)?;
            } else {
                return Err(invalid_manifest("插件包只能包含普通文件和目录"));
            }
        }
        Ok(())
    }
    let source = cap_std::fs::Dir::open_ambient_dir(source, cap_std::ambient_authority())
        .map_err(io_error)?;
    std::fs::create_dir_all(
        destination
            .parent()
            .ok_or_else(|| invalid_manifest("插件目标目录无效"))?,
    )
    .map_err(io_error)?;
    std::fs::create_dir(destination).map_err(io_error)?;
    let result = (|| {
        let target = cap_std::fs::Dir::open_ambient_dir(destination, cap_std::ambient_authority())
            .map_err(io_error)?;
        walk(&source, &target, &mut 0, &mut 0, 0)
    })();
    if result.is_err() {
        let _ = std::fs::remove_dir_all(destination);
    }
    result
}
pub(crate) async fn inspect(path: PathBuf) -> Result<Value, DomainError> {
    tokio::task::spawn_blocking(move || inspect_manifest(&path))
        .await
        .map_err(|_| DomainError::new(ErrorKind::Internal, "插件检查未完成"))?
}
fn invalid_manifest(message: &str) -> DomainError {
    DomainError::new(ErrorKind::PluginInvalid, message)
}
fn inspect_manifest(path: &Path) -> Result<Value, DomainError> {
    let bytes = resources::read(path, "plugin.json", 65536)?;
    let manifest: Value =
        serde_json::from_slice(&bytes).map_err(|_| invalid_manifest("插件清单必须是有效 JSON"))?;
    let id = manifest["id"]
        .as_str()
        .ok_or_else(|| invalid_manifest("插件缺少 id"))?;
    if id.is_empty()
        || id.len() > 128
        || !id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || "._-".contains(ch))
    {
        return Err(invalid_manifest("插件 id 无效"));
    }
    if manifest["manifestVersion"] != 1 || manifest["engines"]["pluginApi"] != ">=0.1 <0.2" {
        return Err(DomainError::new(
            ErrorKind::PluginIncompatible,
            "插件 API 版本不兼容",
        ));
    }
    if manifest["entrypoints"].get("worker").is_some() {
        resources::validate(
            path,
            manifest["entrypoints"]["worker"]["path"]
                .as_str()
                .ok_or_else(|| invalid_manifest("缺少 Worker 入口"))?,
        )?;
    }
    if let Some(app) = manifest["entrypoints"].get("app") {
        resources::text(
            path,
            app["path"]
                .as_str()
                .ok_or_else(|| invalid_manifest("缺少 App 入口"))?,
            16 * 1024 * 1024,
        )?;
    }
    let mut ids = std::collections::HashSet::new();
    for item in manifest["contributions"]
        .as_array()
        .ok_or_else(|| invalid_manifest("插件缺少扩展点声明"))?
    {
        let id = item["id"]
            .as_str()
            .ok_or_else(|| invalid_manifest("扩展点缺少 id"))?;
        if !ids.insert(id) || item["kindVersion"] != 1 {
            return Err(invalid_manifest("扩展点重复或版本不兼容"));
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
            return Err(DomainError::new(
                ErrorKind::PluginIncompatible,
                "当前版本不支持此扩展点或绑定",
            ));
        }
        if item["kind"] == "agent.provider" {
            if !manifest["hostRequirements"]
                .as_array()
                .is_some_and(|caps| caps.iter().any(|cap| cap == "agent.spawn"))
            {
                return Err(invalid_manifest("Agent Provider 必须声明 agent.spawn 权限"));
            }
            let descriptor = &item["binding"]["descriptor"];
            let command = descriptor["command"].as_str().unwrap_or_default();
            if command.is_empty()
                || command != "$node"
                    && !std::path::Path::new(command).is_absolute()
                    && !files::resolve(path, command, false)?.is_file()
            {
                return Err(invalid_manifest("Provider 启动程序不存在"));
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
                return Err(invalid_manifest("Provider 启动参数或包内路径无效"));
            }
        }
    }
    if let Some(dependencies) = manifest["dependencies"].as_object()
        && !dependencies.is_empty()
    {
        return Err(invalid_manifest("当前版本要求插件自包含；请打包依赖后安装"));
    }
    Ok(manifest)
}
fn validate_publication(
    workbench: &Workbench,
    record: &Value,
    base: u64,
    created: std::time::Instant,
) -> Result<(), DomainError> {
    if created.elapsed() >= Duration::from_secs(600) {
        return Err(plugin_failure(
            ErrorKind::PluginCandidateExpired,
            "插件候选已过期，请重新准备",
        ));
    }
    let id = record["id"]
        .as_str()
        .ok_or_else(|| invalid_manifest("插件 id 无效"))?;
    let installed = workbench.catalog("plugin");
    let current = installed.iter().find(|record| record["id"] == id);
    if current
        .and_then(|record| record["generation"].as_u64())
        .unwrap_or(0)
        != base
    {
        return Err(plugin_failure(
            ErrorKind::PluginGenerationConflict,
            "插件已在其他窗口更新，请重新加载候选",
        ));
    }
    if current.is_none() && installed.len() >= 64 {
        return Err(plugin_failure(
            ErrorKind::PluginLimit,
            "本地插件数量已达到当前版本上限",
        ));
    }
    Ok(())
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
    ) -> Result<Arc<PluginManager>, DomainError> {
        let runtime = self.runtime();
        let sdk = runtime
            .parent()
            .and_then(Path::parent)
            .and_then(Path::parent)
            .ok_or_else(|| plugin_failure(ErrorKind::PluginUnavailable, "插件运行时路径无效"))?
            .join("plugin-sdk");
        let destination = self.directory.join("node_modules/@vibeone/plugin-sdk");
        if !destination.exists() {
            tokio::task::spawn_blocking(move || copy_package(&sdk, &destination))
                .await
                .map_err(|_| plugin_failure(ErrorKind::Internal, "插件运行时准备未完成"))??;
        }
        let node = find_node().ok_or_else(|| {
            plugin_failure(
                ErrorKind::PluginUnavailable,
                "未找到 Node.js 22+，请安装后重试",
            )
        })?;
        let host = PluginHost::spawn(&node, &runtime, Arc::new(Broker(Arc::downgrade(workbench))))
            .await
            .map_err(|error| worker_error(error, ErrorKind::PluginActivationFailed))?;
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
                package_path: PathBuf::from(
                    record["path"]
                        .as_str()
                        .ok_or_else(|| invalid_manifest("插件路径无效"))?,
                ),
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
            .map_err(|error| worker_error(error, ErrorKind::PluginActivationFailed))?;
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
                    record["error"] = json!(error.message);
                    let id = record["id"].as_str().unwrap_or_default().to_owned();
                    let _ = workbench.put_catalog("plugin", &id, record).await;
                }
            }
        }
    }
    pub async fn prepare(
        &self,
        workbench: &Arc<Workbench>,
        body: Value,
    ) -> Result<Value, DomainError> {
        workbench.command_available()?;
        let _gate = self.gate.lock().await;
        workbench.command_available()?;
        if body["trusted"] != true {
            return Err(plugin_failure(
                ErrorKind::PluginTrustRequired,
                "请先确认信任本地插件代码与声明权限",
            ));
        }
        self.pending
            .lock()
            .expect("plugins poisoned")
            .retain(|_, candidate| candidate.created.elapsed() < Duration::from_secs(600));
        if self.pending.lock().expect("plugins poisoned").len() >= 8 {
            return Err(plugin_failure(
                ErrorKind::PluginCandidateLimit,
                "有过多待确认的插件更新，请先完成或取消",
            ));
        }
        let source = PathBuf::from(
            body["path"]
                .as_str()
                .ok_or_else(|| plugin_failure(ErrorKind::InvalidInput, "请选择插件目录"))?,
        )
        .canonicalize()
        .map_err(resources::io_error)?;
        let mut manifest = inspect(source.clone()).await?;
        if body.get("expectedManifest").is_some() && body["expectedManifest"] != manifest {
            return Err(plugin_failure(
                ErrorKind::PluginManifestChanged,
                "插件清单已变化，请重新检查并授权",
            ));
        }
        let id = manifest["id"].as_str().unwrap_or_default().to_owned();
        if workbench.catalog("plugin").len() >= 64
            && !workbench
                .catalog("plugin")
                .iter()
                .any(|record| record["id"] == id)
        {
            return Err(plugin_failure(
                ErrorKind::PluginLimit,
                "本地插件数量已达到当前版本上限",
            ));
        }
        let capabilities = manifest["hostRequirements"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        if !capabilities.iter().all(|item| {
            matches!(
                item.as_str(),
                Some("workspace.read" | "notifications.send" | "agent.spawn" | "artifact.write" | "desktop.terminal" | "desktop.browser")
            )
        }) {
            return Err(plugin_failure(
                ErrorKind::PluginIncompatible,
                "插件声明了当前宿主不支持的权限",
            ));
        }
        if body
            .get("workspaces")
            .is_some_and(|value| !value.is_null() && !value.is_array())
        {
            return Err(plugin_failure(
                ErrorKind::InvalidInput,
                "插件工作区授权必须为数组",
            ));
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
            return Err(plugin_failure(
                ErrorKind::PluginPermissionDenied,
                "插件工作区授权无效",
            ));
        }
        if !body["config"].is_null() && !body["config"].is_object() {
            return Err(plugin_failure(
                ErrorKind::PluginConfigurationInvalid,
                "插件配置须为 JSON 对象",
            ));
        }
        if let Some(schema) = manifest.get("configurationSchema") {
            let validator = jsonschema::validator_for(schema)
                .map_err(|_| invalid_manifest("插件配置Schema无效"))?;
            validator
                .validate(&body.get("config").cloned().unwrap_or_else(|| json!({})))
                .map_err(|_| {
                    plugin_failure(
                        ErrorKind::PluginConfigurationInvalid,
                        "插件配置不符合要求，请检查字段类型和必填项",
                    )
                })?;
        }
        let ticket = uuid::Uuid::new_v4().to_string();
        let destination = self.directory.join("plugins").join(&id).join(&ticket);
        if source.starts_with(&destination) || destination.starts_with(&source) {
            return Err(plugin_failure(
                ErrorKind::PluginInvalid,
                "插件源目录不能包含安装目录",
            ));
        }
        let from = source.clone();
        let to = destination.clone();
        tokio::task::spawn_blocking(move || copy_package(&from, &to))
            .await
            .map_err(|_| plugin_failure(ErrorKind::Internal, "插件包复制任务未完成"))??;
        let copied_manifest = inspect(destination.clone()).await;
        let copied_error = match copied_manifest {
            Ok(copied) if copied == manifest => None,
            Ok(_) => Some(plugin_failure(
                ErrorKind::PluginManifestChanged,
                "插件清单在复制期间变化，请重新检查并授权",
            )),
            Err(error) => Some(error),
        };
        if let Some(error) = copied_error {
            let _ = tokio::fs::remove_dir_all(&destination).await;
            return Err(error);
        }
        let generated: Result<(), DomainError> = async {
            if manifest["entrypoints"].get("worker").is_none() {
                manifest["entrypoints"]["worker"] =
                    json!({"path":"vibeone-noop.mjs","runtime":"node","protocolVersion":1});
                tokio::fs::write(
                    destination.join("vibeone-noop.mjs"),
                    "export default {apiVersion:'0.1',setup(){}};",
                )
                .await
                .map_err(|_| {
                    plugin_failure(ErrorKind::PluginUnavailable, "无法写入插件候选资源")
                })?;
                tokio::fs::write(
                    destination.join("plugin.json"),
                    serde_json::to_vec(&manifest).map_err(|_| {
                        plugin_failure(ErrorKind::PluginUnavailable, "无法写入插件候选资源")
                    })?,
                )
                .await
                .map_err(|_| {
                    plugin_failure(ErrorKind::PluginUnavailable, "无法写入插件候选资源")
                })?;
            }
            Ok(())
        }
        .await;
        if let Err(error) = generated {
            let _ = tokio::fs::remove_dir_all(&destination).await;
            return Err(error);
        }
        let old = workbench
            .catalog("plugin")
            .into_iter()
            .find(|record| record["id"] == id);
        let base = old
            .as_ref()
            .and_then(|record| record["generation"].as_u64())
            .unwrap_or(0);
        let generation = base.checked_add(1).ok_or_else(|| {
            plugin_failure(ErrorKind::PluginGenerationConflict, "插件代次无法继续递增")
        })?;
        let record = json!({"id":id,"name":manifest["name"],"version":manifest["version"],"manifest":manifest,"path":destination,"generation":generation,"enabled":true,"capabilities":capabilities,"workspaces":workspaces,"source":body["source"].clone(),"config":body["config"].as_object().cloned().unwrap_or_default(),"error":null});
        // Validate the copied candidate's App before starting plugin code.
        let app = match Self::app(record.clone()).await {
            Ok(app) => app,
            Err(error) => {
                let _ = tokio::fs::remove_dir_all(&destination).await;
                return Err(error);
            }
        };
        let manager = match self.activate(workbench, &record).await {
            Ok(manager) => manager,
            Err(error) => {
                let _ = tokio::fs::remove_dir_all(destination).await;
                return Err(error);
            }
        };

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
    pub async fn app(record: Value) -> Result<Value, DomainError> {
        tokio::task::spawn_blocking(move || {
            let Some(path) = record["manifest"]["entrypoints"]["app"]["path"].as_str() else {
                return Ok(Value::Null);
            };
            let root = record["path"]
                .as_str()
                .ok_or_else(|| invalid_manifest("插件目录记录无效"))?;
            let source = resources::text(Path::new(root), path, 16 * 1024 * 1024)?;
            Ok(json!({"source":source}))
        })
        .await
        .map_err(|_| DomainError::new(ErrorKind::Internal, "插件 App 读取未完成"))?
    }
    pub async fn commit(&self, workbench: &Workbench, ticket: &str) -> Result<Value, DomainError> {
        workbench.command_available()?;
        let _gate = self.gate.lock().await;
        workbench.command_available()?;
        let candidate = self
            .pending
            .lock()
            .expect("plugins poisoned")
            .remove(ticket)
            .ok_or_else(|| {
                plugin_failure(
                    ErrorKind::PluginCandidateExpired,
                    "插件候选已失效，请重新准备",
                )
            })?;
        validate_publication(
            workbench,
            &candidate.record,
            candidate.base,
            candidate.created,
        )?;
        let id = candidate.record["id"]
            .as_str()
            .ok_or_else(|| invalid_manifest("插件 id 无效"))?;
        workbench
            .save_catalog("plugin", id, candidate.record.clone())
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
    pub async fn disable(&self, workbench: &Workbench, id: &str) -> Result<(), DomainError> {
        workbench.command_available()?;
        let _gate = self.gate.lock().await;
        workbench.command_available()?;
        let mut record = workbench
            .catalog("plugin")
            .into_iter()
            .find(|record| record["id"] == id)
            .ok_or_else(|| plugin_failure(ErrorKind::PluginNotFound, "插件不存在"))?;
        record["enabled"] = json!(false);
        workbench.save_catalog("plugin", id, record).await?;
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
    ) -> Result<Value, DomainError> {
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
                current["error"] = json!(error.message);
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
    ) -> Result<PreparedInvocation, DomainError> {
        workbench.command_available()?;
        if !body.is_object() {
            return Err(plugin_failure(
                ErrorKind::InvalidInput,
                "插件调用参数须为对象",
            ));
        }
        let gate = self.gate.lock().await;
        workbench.command_available()?;
        let record = workbench
            .catalog("plugin")
            .into_iter()
            .find(|record| record["id"] == id)
            .ok_or_else(|| plugin_failure(ErrorKind::PluginNotFound, "插件未安装"))?;
        if record["enabled"] != true {
            return Err(plugin_failure(ErrorKind::PluginDisabled, "插件未启用"));
        }
        let manager = self
            .current
            .lock()
            .expect("plugins poisoned")
            .get(id)
            .cloned()
            .ok_or_else(|| plugin_failure(ErrorKind::PluginUnavailable, "插件运行连接不可用"))?;
        if body.get("generation").is_some_and(|value| !value.is_u64())
            || body
                .get("workspaceId")
                .is_some_and(|value| !value.is_null() && !value.is_string())
        {
            return Err(plugin_failure(
                ErrorKind::InvalidInput,
                "插件代次或工作区参数类型无效",
            ));
        }
        if let Some(generation) = body["generation"].as_u64()
            && Some(generation) != record["generation"].as_u64()
        {
            return Err(plugin_failure(
                ErrorKind::PluginGenerationConflict,
                "插件代次已变化，请刷新界面",
            ));
        }
        let handler = body["handler"]
            .as_str()
            .filter(|handler| !handler.is_empty())
            .ok_or_else(|| plugin_failure(ErrorKind::InvalidInput, "缺少处理器"))?;
        if !record["manifest"]["contributions"]
            .as_array()
            .is_some_and(|items| {
                items.iter().any(|item| {
                    item["binding"]["type"] == "worker" && item["binding"]["handler"] == handler
                })
            })
        {
            return Err(plugin_failure(
                ErrorKind::PluginPermissionDenied,
                "处理器未通过清单公开",
            ));
        }
        let workspace = body["workspaceId"].as_str();
        if let Some(workspace) = workspace
            && !record["workspaces"]
                .as_array()
                .is_some_and(|items| items.iter().any(|item| item == workspace))
        {
            return Err(plugin_failure(
                ErrorKind::PluginPermissionDenied,
                "插件未获授权访问此工作区",
            ));
        }
        let lease = manager
            .acquire(id)
            .map_err(|_| plugin_failure(ErrorKind::PluginUnavailable, "插件运行路由不可用"))?;
        if Some(lease.key().generation) != record["generation"].as_u64() {
            return Err(plugin_failure(
                ErrorKind::PluginGenerationConflict,
                "插件代次正在切换，请稍后重试",
            ));
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

#[cfg(test)]
mod lifecycle_tests {
    use super::*;
    #[tokio::test]
    async fn publication_rechecks_capacity_expiry_and_current_generation() {
        let directory = tempfile::tempdir().unwrap();
        let workbench = Workbench::open(directory.path(), vec![]).await.unwrap();
        for index in 0..63 {
            let id = format!("installed-{index}");
            workbench
                .save_catalog(
                    "plugin",
                    &id,
                    json!({"id":id,"generation":1,"enabled":false}),
                )
                .await
                .unwrap();
        }
        let source = directory.path().join("source");
        std::fs::create_dir(&source).unwrap();
        std::fs::write(
            source.join("worker.mjs"),
            "export default {apiVersion:'0.1',setup(){}};",
        )
        .unwrap();
        let mut candidates = vec![];
        for id in ["fixture.a", "fixture.b", "installed-0"] {
            std::fs::write(source.join("plugin.json"),serde_json::to_vec(&json!({"manifestVersion":1,"id":id,"name":"Fixture","version":"0.1.0","engines":{"pluginApi":">=0.1 <0.2"},"entrypoints":{"worker":{"path":"worker.mjs","runtime":"node","protocolVersion":1}},"contributions":[]})).unwrap()).unwrap();
            candidates.push(
                workbench
                    .plugins
                    .prepare(&workbench, json!({"path":source,"trusted":true}))
                    .await
                    .unwrap(),
            );
        }
        workbench
            .plugins
            .commit(&workbench, candidates[0]["ticket"].as_str().unwrap())
            .await
            .unwrap();
        assert_eq!(
            workbench
                .plugins
                .commit(&workbench, candidates[1]["ticket"].as_str().unwrap())
                .await
                .unwrap_err()
                .kind,
            ErrorKind::PluginLimit
        );
        assert_eq!(workbench.catalog("plugin").len(), 64);
        assert!(workbench.plugins.acquire("fixture.b").is_err());
        let expired = candidates[2]["ticket"].as_str().unwrap();
        workbench
            .plugins
            .pending
            .lock()
            .unwrap()
            .get_mut(expired)
            .unwrap()
            .created = std::time::Instant::now() - Duration::from_secs(601);
        assert_eq!(
            workbench
                .plugins
                .commit(&workbench, expired)
                .await
                .unwrap_err()
                .kind,
            ErrorKind::PluginCandidateExpired
        );
        assert_eq!(
            workbench
                .catalog("plugin")
                .into_iter()
                .find(|item| item["id"] == "installed-0")
                .unwrap()["enabled"],
            false
        );
        assert_eq!(
            validate_publication(
                &workbench,
                &json!({"id":"fixture.a"}),
                0,
                std::time::Instant::now()
            )
            .unwrap_err()
            .kind,
            ErrorKind::PluginGenerationConflict
        );
        workbench.close().await;
    }
    #[test]
    fn worker_failures_have_safe_messages_and_preserve_transport_identity() {
        let error = worker_error(
            Error::Remote {
                code: "PRIVATE_CODE".into(),
                message: "PRIVATE_VALUE".into(),
            },
            ErrorKind::PluginOperationFailed,
        );
        assert_eq!(error.kind, ErrorKind::PluginOperationFailed);
        assert!(!error.message.contains("PRIVATE"));
        assert_eq!(
            worker_error(Error::Timeout, ErrorKind::PluginOperationFailed).kind,
            ErrorKind::PluginTimeout
        );
        assert_eq!(
            worker_error(
                Error::Closed("PRIVATE_VALUE".into()),
                ErrorKind::PluginOperationFailed
            )
            .kind,
            ErrorKind::PluginUnavailable
        );
    }
    #[test]
    fn package_copy_keeps_executable_bits_and_cleans_oversized_candidates() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("source");
        let target = directory.path().join("target-package");
        std::fs::create_dir(&source).unwrap();
        let file = source.join("entry");
        std::fs::write(&file, b"script").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        copy_package(&source, &target).unwrap();
        assert_eq!(std::fs::read(target.join("entry")).unwrap(), b"script");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(target.join("entry"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o111,
                0o111
            );
        }
        std::fs::remove_dir_all(&target).unwrap();
        std::fs::File::create(source.join("large"))
            .unwrap()
            .set_len(20 * 1024 * 1024 + 1)
            .unwrap();
        assert_eq!(
            copy_package(&source, &target).unwrap_err().kind,
            ErrorKind::PluginResourceTooLarge
        );
        assert!(!target.exists());
    }
}
