use super::*;

impl Workbench {
    pub(crate) fn provider_descriptors(&self) -> Vec<Provider> {
        let mut providers = self.providers.clone();
        for record in self
            .catalog("plugin")
            .into_iter()
            .filter(|record| record["enabled"] == true)
        {
            if !record["capabilities"]
                .as_array()
                .is_some_and(|caps| caps.iter().any(|cap| cap == "agent.spawn"))
            {
                continue;
            }
            for contribution in record["manifest"]["contributions"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .filter(|item| {
                    item["kind"] == "agent.provider" && item["binding"]["type"] == "declarative"
                })
            {
                let descriptor = &contribution["binding"]["descriptor"];
                let command = descriptor["command"].as_str().unwrap_or_default();
                let root = Path::new(record["path"].as_str().unwrap_or_default());
                let command = if command == "$node" {
                    crate::providers::find_node().unwrap_or_default()
                } else if Path::new(command).is_absolute() {
                    PathBuf::from(command)
                } else {
                    crate::files::resolve(root, command, false).unwrap_or_default()
                };
                let args = descriptor["args"]
                    .as_array()
                    .map(|args| {
                        args.iter()
                            .filter_map(|arg| arg.as_str())
                            .map(|arg| {
                                if let Some(path) = arg.strip_prefix("$package/") {
                                    root.join(path).to_string_lossy().into_owned()
                                } else {
                                    arg.into()
                                }
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                providers.push(Provider {
                    id: format!(
                        "{}:{}",
                        record["id"].as_str().unwrap_or_default(),
                        contribution["id"].as_str().unwrap_or_default()
                    ),
                    name: descriptor["name"].as_str().unwrap_or("插件 Agent").into(),
                    available: command.is_file(),
                    description: format!(
                        "插件 {} · 代次 {}",
                        record["id"].as_str().unwrap_or_default(),
                        record["generation"]
                    ),
                    command,
                    args,
                });
            }
        }
        providers
    }
    pub(crate) fn catalog(&self, kind: &str) -> Vec<Value> {
        let catalog = self.catalog.lock().expect("catalog poisoned");
        let mut values: Vec<_> = catalog
            .get(kind)
            .map(|items| items.values().cloned().collect())
            .unwrap_or_default();
        values.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));
        values
    }
    pub(crate) async fn put_catalog(
        &self,
        kind: &str,
        id: &str,
        value: Value,
    ) -> Result<(), String> {
        self.available()?;
        let _gate = self.catalog_gate.lock().await;
        let cursor = self
            .store
            .put_catalog(kind, id, &value)
            .await
            .map_err(|error| self.fail_storage(error))?;
        let _publication = self.publication.lock().expect("publication poisoned");
        let mut catalog = self.catalog.lock().expect("catalog poisoned");
        let items = catalog.entry(kind.into()).or_default();
        if value.is_null() {
            items.remove(id);
        } else {
            items.insert(id.into(), value);
        }
        self.changed(cursor);
        Ok(())
    }
    pub(crate) async fn import_workspace(&self, path: &str) -> Result<Value, String> {
        self.available()?;
        let path = PathBuf::from(path)
            .canonicalize()
            .map_err(|_| "目录不存在")?;
        if !path.is_dir() {
            return Err("请选择工作目录".into());
        }
        let _gate = self.catalog_gate.lock().await;
        let cursor = self
            .store
            .import_workspace(path.to_str().ok_or("目录名称无效")?)
            .await
            .map_err(|error| self.fail_storage(error))?;
        let workspaces = self
            .store
            .workspaces()
            .await
            .map_err(|error| self.fail_storage(error))?;
        let workspace = workspaces
            .iter()
            .find(|item| Path::new(&item.path) == path)
            .cloned()
            .ok_or("工作区未保存")?;
        let _publication = self.publication.lock().expect("publication poisoned");
        *self.workspaces.lock().expect("workspaces poisoned") = workspaces;
        self.changed(cursor);
        serde_json::to_value(workspace).map_err(|error| error.to_string())
    }
    pub(crate) async fn save_profile(&self, mut value: Value) -> Result<Value, String> {
        let name = value["name"].as_str().ok_or("请输入配置名称")?.trim();
        if name.is_empty() || name.chars().count() > 80 {
            return Err("配置名称须为 1–80 个字符".into());
        }
        value["name"] = json!(name);
        let provider = value["provider"].as_str().ok_or("请选择 Agent Provider")?;
        if !self
            .provider_descriptors()
            .iter()
            .any(|item| item.id == provider)
        {
            return Err("未知 Agent Provider".into());
        }
        if let Some(command) = value["command"].as_str().filter(|text| !text.is_empty()) {
            let path = Path::new(command);
            if !path.is_absolute() || !path.is_file() {
                return Err("自定义启动程序须为存在的绝对路径".into());
            }
        }
        if let Some(args) = value.get("args")
            && (!args.is_array()
                || !args.as_array().is_some_and(|args| {
                    args.len() <= 64
                        && args
                            .iter()
                            .all(|arg| arg.as_str().is_some_and(|arg| arg.len() <= 4096))
                }))
        {
            return Err("启动参数须为字符串数组，最多 64 项".into());
        }
        let id = value["id"]
            .as_str()
            .filter(|id| !id.is_empty())
            .map(str::to_owned)
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        if self.catalog("profile").len() >= 64
            && !self.catalog("profile").iter().any(|item| item["id"] == id)
        {
            return Err("配置数量已达到上限".into());
        }
        let revision = self
            .catalog("profile")
            .iter()
            .find(|item| item["id"] == id)
            .and_then(|item| item["revision"].as_u64())
            .unwrap_or(0)
            + 1;
        value["id"] = json!(id);
        value["revision"] = json!(revision);
        self.put_catalog("profile", &id, value.clone()).await?;
        Ok(value)
    }
    pub(crate) async fn event_page(&self, after: u64) -> Result<Value, String> {
        if after > i64::MAX as u64 {
            return Err("事件游标无效".into());
        }
        let events = self
            .store
            .events(after, 256)
            .await
            .map_err(|error| error.to_string())?;
        Ok(
            json!({"events":events,"cursor":events.last().and_then(|event|event["cursor"].as_u64()).unwrap_or(after),"hasMore":events.len()==256}),
        )
    }
    pub(crate) fn diagnostics(&self) -> Value {
        // Export an allowlist of counts/statuses, never messages, paths, raw errors or credentials.
        let snapshot = self.snapshot();
        let sessions=snapshot["sessions"].as_array().map(|sessions|sessions.iter().map(|session|json!({"id":session["id"],"provider":session["provider"],"status":session["status"],"runs":session["runs"].as_array().map(Vec::len),"queued":session["queue"].as_array().map(Vec::len),"approvals":session["approvals"].as_array().map(Vec::len)})).collect::<Vec<_>>()).unwrap_or_default();
        json!({"version":env!("CARGO_PKG_VERSION"),"protocolVersion":2,"sdkVersion":"5.0.0","persistent":true,"storageAvailable":snapshot["storageError"].is_null(),"sessions":sessions,"plugins":self.catalog("plugin").iter().map(|plugin|json!({"id":plugin["id"],"enabled":plugin["enabled"],"generation":plugin["generation"]})).collect::<Vec<_>>()})
    }
}
