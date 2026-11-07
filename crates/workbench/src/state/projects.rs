use super::*;
impl Workbench {
    pub(crate) fn project_views(&self) -> Vec<Value> {
        let mut projects = self.catalog("project");
        let covered: Vec<String> = projects
            .iter()
            .flat_map(|p| {
                p["paths"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
            })
            .collect();
        for workspace in self.workspaces.lock().expect("workspaces poisoned").iter() {
            if !covered.contains(&workspace.path) {
                projects.push(json!({"id":format!("workspace:{}",workspace.id),"name":workspace.name,"paths":[workspace.path],"revision":0,"implicit":true}));
            }
        }
        projects
    }
    pub(crate) async fn save_project(&self, body: Value) -> Result<Value, DomainError> {
        self.command_available()?;
        let id = body["id"]
            .as_str()
            .filter(|id| !id.is_empty() && id.len() <= 128)
            .ok_or_else(|| DomainError::new(ErrorKind::InvalidInput, "项目标识无效"))?
            .to_owned();
        let path = if let Some(path) = body["addPath"].as_str() {
            Some(
                self.import_workspace(path).await?["path"]
                    .as_str()
                    .unwrap_or_default()
                    .to_owned(),
            )
        } else {
            None
        };
        let _gate = self.catalog_gate.lock().await;
        let mut value = self
            .project_views()
            .into_iter()
            .find(|p| p["id"] == id)
            .unwrap_or_else(|| json!({"id":id,"name":"新项目","paths":[],"revision":0}));
        if let Some(expected) = body.get("revision").and_then(Value::as_u64) {
            if expected != value["revision"].as_u64().unwrap_or(0) {
                return Err(DomainError::new(
                    ErrorKind::ContextConflict,
                    "项目已更新，请刷新后重试",
                ));
            }
        }
        if let Some(name) = body.get("name") {
            let name = name
                .as_str()
                .map(str::trim)
                .filter(|s| !s.is_empty() && s.chars().count() <= 120)
                .ok_or_else(|| {
                    DomainError::new(ErrorKind::InvalidInput, "项目名称需为1到120个字符")
                })?;
            value["name"] = json!(name);
        }
        if let Some(path) = path {
            if self.catalog("project").iter().any(|p| {
                p["id"] != id
                    && p["paths"]
                        .as_array()
                        .is_some_and(|paths| paths.iter().any(|p| p == &path))
            }) {
                return Err(DomainError::new(
                    ErrorKind::ContextConflict,
                    "此工作目录已属于其他项目",
                ));
            }
            let paths = value["paths"].as_array_mut().expect("project paths");
            if !paths.iter().any(|p| p == &path) {
                if paths.len() >= 32 {
                    return Err(DomainError::new(
                        ErrorKind::InvalidInput,
                        "每个项目最多引入32个工作目录",
                    ));
                }
                paths.push(json!(path));
            }
        }
        value["revision"] = json!(value["revision"].as_u64().unwrap_or(0) + 1);
        value["implicit"] = json!(false);
        self.put_catalog_locked("project", &id, value.clone())
            .await?;
        Ok(value)
    }
}
