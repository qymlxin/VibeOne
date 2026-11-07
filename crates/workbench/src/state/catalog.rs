use super::*;
use crate::domain_error::{DomainError, ErrorKind};

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
        self.save_catalog(kind, id, value)
            .await
            .map_err(|error| error.to_string())
    }
    pub(crate) async fn save_catalog(
        &self,
        kind: &str,
        id: &str,
        value: Value,
    ) -> Result<(), DomainError> {
        self.command_available()?;
        let _gate = self.catalog_gate.lock().await;
        self.put_catalog_locked(kind, id, value).await
    }
    pub(super) async fn put_catalog_locked(
        &self,
        kind: &str,
        id: &str,
        value: Value,
    ) -> Result<(), DomainError> {
        self.put_catalog_with_receipt_locked(kind, id, value, None)
            .await
    }
    pub(super) async fn put_catalog_with_receipt_locked(
        &self,
        kind: &str,
        id: &str,
        value: Value,
        receipt: Option<(&str, &str, &Value)>,
    ) -> Result<(), DomainError> {
        self.command_available()?;
        let _sync = self.sync_gate.lock().await;
        let cursor = self
            .store
            .put_catalog_with_receipt(kind, id, &value, receipt)
            .await
            .map_err(|error| {
                self.fail_storage(error);
                DomainError::storage()
            })?;
        let _publication = self.publication.lock().expect("publication poisoned");
        let mut catalog = self.catalog.lock().expect("catalog poisoned");
        let items = catalog.entry(kind.into()).or_default();
        if value.is_null() {
            items.remove(id);
        } else {
            items.insert(id.into(), value);
        }
        if let Some((kind, id, value)) = receipt {
            catalog
                .entry(kind.into())
                .or_default()
                .insert(id.into(), value.clone());
        }
        self.changed(cursor);
        Ok(())
    }
    pub(crate) async fn import_workspace(&self, path: &str) -> Result<Value, DomainError> {
        self.command_available()?;
        let path = PathBuf::from(path).canonicalize().map_err(|error| {
            DomainError::new(
                match error.kind() {
                    std::io::ErrorKind::NotFound => ErrorKind::WorkspaceNotFound,
                    std::io::ErrorKind::PermissionDenied => ErrorKind::WorkspaceForbidden,
                    _ => ErrorKind::InvalidInput,
                },
                "无法访问工作目录，请检查目录是否存在及访问权限",
            )
        })?;
        if !path.is_dir() {
            return Err(DomainError::new(ErrorKind::InvalidInput, "请选择工作目录"));
        }
        let _gate = self.catalog_gate.lock().await;
        let _sync = self.sync_gate.lock().await;
        let cursor = self
            .store
            .import_workspace(
                path.to_str()
                    .ok_or_else(|| DomainError::new(ErrorKind::InvalidInput, "目录名称无效"))?,
            )
            .await
            .map_err(|error| {
                self.fail_storage(error);
                DomainError::storage()
            })?;
        let workspaces = self.store.workspaces().await.map_err(|error| {
            self.fail_storage(error);
            DomainError::storage()
        })?;
        let workspace = workspaces
            .iter()
            .find(|item| Path::new(&item.path) == path)
            .cloned()
            .ok_or_else(|| DomainError::new(ErrorKind::Internal, "工作区未保存"))?;
        let _publication = self.publication.lock().expect("publication poisoned");
        *self.workspaces.lock().expect("workspaces poisoned") = workspaces;
        self.changed(cursor);
        serde_json::to_value(workspace)
            .map_err(|_| DomainError::new(ErrorKind::Internal, "工作区响应编码失败"))
    }
    fn profile_value(&self, id: &str) -> Result<Value, String> {
        self.catalog
            .lock()
            .expect("catalog poisoned")
            .get("profile")
            .and_then(|items| items.get(id))
            .cloned()
            .ok_or_else(|| "配置不存在，请新建配置".into())
    }
    fn profile_hash(value: &Value) -> String {
        use sha2::{Digest, Sha256};
        Sha256::digest(serde_json::to_vec(value).expect("JSON value serializes"))
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }
    fn decode_profile(id: &str, value: Value) -> Result<crate::contracts::ProfileView, String> {
        let profile: crate::contracts::ProfileView =
            serde_json::from_value(value).map_err(|_| "配置记录格式无效，原始记录仍保留在本地")?;
        if profile.id != id || profile.name.trim().is_empty() || profile.provider.trim().is_empty()
        {
            return Err("配置身份或名称无效，原始记录仍保留在本地".into());
        }
        Ok(profile)
    }
    pub(crate) fn profile_catalog(&self) -> crate::contracts::ProfileCatalogResponse {
        let (profiles, issues) = self.profile_views();
        crate::contracts::ProfileCatalogResponse {
            profiles: profiles
                .into_iter()
                .map(|profile| crate::contracts::ProfileSummary {
                    id: profile.id,
                    name: profile.name,
                    provider: profile.provider,
                    revision: profile.details.revision,
                })
                .collect(),
            issues,
        }
    }
    pub(crate) fn profile_views(
        &self,
    ) -> (
        Vec<crate::contracts::ProfileView>,
        Vec<crate::contracts::ProfileIssue>,
    ) {
        let catalog = self.catalog.lock().expect("catalog poisoned");
        let mut profiles = vec![];
        let mut issues = vec![];
        for (id, value) in catalog.get("profile").into_iter().flatten() {
            match Self::decode_profile(id, value.clone()) {
                Ok(profile) => profiles.push(profile),
                Err(error) => issues.push(crate::contracts::ProfileIssue {
                    id: id.clone(),
                    error,
                    revision: value["revision"].as_u64(),
                    record_hash: Self::profile_hash(value),
                }),
            }
        }
        profiles.sort_by(|a, b| a.id.cmp(&b.id));
        issues.sort_by(|a, b| a.id.cmp(&b.id));
        (profiles, issues)
    }
    pub(crate) fn profile_view(
        &self,
        id: &str,
    ) -> Result<crate::contracts::ProfileView, DomainError> {
        let value = self
            .profile_value(id)
            .map_err(|_| DomainError::new(ErrorKind::ProfileNotFound, "配置不存在，请新建配置"))?;
        Self::decode_profile(id, value).map_err(|_| {
            DomainError::new(
                ErrorKind::ProfileInvalid,
                "配置记录无效，请在 Agent 设置中检查；原始记录仍保留",
            )
        })
    }
    pub(crate) async fn save_profile(
        &self,
        mut request: crate::contracts::ProfileRequest,
    ) -> Result<crate::contracts::ProfileResponse, DomainError> {
        self.command_available()?;
        let _gate = self.catalog_gate.lock().await;
        self.command_available()?;
        let key = request
            .key
            .take()
            .map(|key| {
                if key.is_empty() || key.len() > 128 {
                    return Err(DomainError::new(
                        ErrorKind::InvalidInput,
                        "配置幂等键必须为1至128字节",
                    ));
                }
                Ok(Self::profile_hash(&json!(key)))
            })
            .transpose()?;
        let fingerprint = Self::profile_hash(
            &serde_json::to_value(&request)
                .map_err(|_| DomainError::new(ErrorKind::Internal, "配置参数编码失败"))?,
        );
        if let Some(key) = &key {
            let saved = self
                .catalog
                .lock()
                .expect("catalog poisoned")
                .get("profile-command")
                .and_then(|items| items.get(key))
                .cloned();
            if let Some(saved) = saved {
                if saved["fingerprint"] != fingerprint {
                    return Err(DomainError::new(
                        ErrorKind::IdempotencyConflict,
                        "同一配置幂等键的参数不同",
                    ));
                }
                return serde_json::from_value(saved["result"].clone())
                    .map_err(|_| DomainError::new(ErrorKind::Internal, "配置操作回执无效"));
            }
        }
        let existing = request
            .id
            .as_deref()
            .map(|id| {
                self.profile_value(id).map_err(|_| {
                    DomainError::new(ErrorKind::ProfileNotFound, "配置不存在，请新建配置")
                })
            })
            .transpose()?;
        if let Some(existing) = &existing
            && (request
                .revision
                .is_some_and(|revision| existing["revision"] != revision)
                || request
                    .record_hash
                    .as_ref()
                    .is_some_and(|hash| *hash != Self::profile_hash(existing)))
        {
            return Err(DomainError::new(
                ErrorKind::ProfileConflict,
                "配置已更新，请重新加载后修改",
            ));
        }
        if request.remove {
            let id = request
                .id
                .as_deref()
                .ok_or_else(|| DomainError::new(ErrorKind::InvalidInput, "请选择配置"))?;
            let receipt = json!({"fingerprint":fingerprint,"result":{"removed":true}});
            self.put_catalog_with_receipt_locked(
                "profile",
                id,
                Value::Null,
                key.as_deref().map(|key| ("profile-command", key, &receipt)),
            )
            .await?;
            return Ok(crate::contracts::ProfileResponse::Removed { removed: true });
        }
        let name = request
            .name
            .as_deref()
            .ok_or_else(|| DomainError::new(ErrorKind::InvalidInput, "请输入配置名称"))?
            .trim();
        if name.is_empty() || name.chars().count() > 80 {
            return Err(DomainError::new(
                ErrorKind::InvalidInput,
                "配置名称须为 1–80 个字符",
            ));
        }
        let provider = request
            .provider
            .as_deref()
            .ok_or_else(|| DomainError::new(ErrorKind::InvalidInput, "请选择 Agent Provider"))?;
        if !self
            .provider_descriptors()
            .iter()
            .any(|item| item.id == provider)
        {
            return Err(DomainError::new(
                ErrorKind::InvalidInput,
                "未知 Agent Provider",
            ));
        }
        if let Some(command) = request.command.as_deref().filter(|text| !text.is_empty()) {
            let path = Path::new(command);
            if !path.is_absolute() || !path.is_file() {
                return Err(DomainError::new(
                    ErrorKind::InvalidInput,
                    "自定义启动程序须为存在的绝对路径",
                ));
            }
        }
        if request
            .args
            .as_ref()
            .is_some_and(|args| args.len() > 64 || args.iter().any(|arg| arg.len() > 4096))
        {
            return Err(DomainError::new(
                ErrorKind::InvalidInput,
                "启动参数须为字符串数组，最多 64 项",
            ));
        }
        let id = request
            .id
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        if self.catalog("profile").len() >= 64 && existing.is_none() {
            return Err(DomainError::new(
                ErrorKind::ProfileLimit,
                "配置数量已达到上限",
            ));
        }
        let revision = existing
            .as_ref()
            .and_then(|record| record["revision"].as_u64())
            .unwrap_or(0)
            .checked_add(1)
            .ok_or_else(|| DomainError::new(ErrorKind::ProfileLimit, "配置修订已达到上限"))?;
        let profile = crate::contracts::ProfileRecord {
            id: id.clone(),
            revision,
            name: name.into(),
            provider: provider.into(),
            command: request.command,
            args: request.args,
        };
        let value = serde_json::to_value(&profile)
            .map_err(|_| DomainError::new(ErrorKind::Internal, "配置编码失败"))?;
        let receipt = json!({"fingerprint":fingerprint,"result":value});
        self.put_catalog_with_receipt_locked(
            "profile",
            &id,
            value,
            key.as_deref().map(|key| ("profile-command", key, &receipt)),
        )
        .await?;
        Ok(crate::contracts::ProfileResponse::Saved(profile))
    }
    pub(crate) async fn event_page(&self, after: u64) -> Result<Value, DomainError> {
        if after > i64::MAX as u64 {
            return Err(DomainError::new(ErrorKind::InvalidInput, "事件游标无效"));
        }
        let events = self.store.events(after, 256).await.map_err(|error| {
            self.fail_storage(error);
            DomainError::storage()
        })?;
        Ok(
            json!({"events":events,"cursor":events.last().and_then(|event|event["cursor"].as_u64()).unwrap_or(after),"hasMore":events.len()==256}),
        )
    }
    pub(crate) async fn diagnostics(&self) -> Value {
        // Export an allowlist of counts/statuses, never messages, paths, raw errors or credentials.
        let snapshot = self.snapshot();
        let sessions=snapshot["sessions"].as_array().map(|sessions|sessions.iter().map(|session|json!({"id":session["id"],"provider":session["provider"],"status":session["status"],"runs":session["runs"].as_array().map(Vec::len),"queued":session["queue"].as_array().map(Vec::len),"approvals":session["approvals"].as_array().map(Vec::len)})).collect::<Vec<_>>()).unwrap_or_default();
        json!({"version":env!("CARGO_PKG_VERSION"),"protocolVersion":2,"sdkVersion":"5.0.0","notificationOutbox":self.store.notification_counts().await.unwrap_or_else(|_|json!({"unavailable":true})),"persistent":true,"storageAvailable":snapshot["storageError"].is_null(),"sessions":sessions,"plugins":self.catalog("plugin").iter().map(|plugin|json!({"id":plugin["id"],"enabled":plugin["enabled"],"generation":plugin["generation"]})).collect::<Vec<_>>()})
    }
}

#[cfg(test)]
mod profile_view_tests {
    use super::*;
    #[tokio::test]
    async fn storage_failure_is_typed_and_never_exposes_internal_paths() {
        let directory = tempfile::tempdir().unwrap();
        let workbench = Workbench::open(directory.path(), vec![]).await.unwrap();
        workbench.store.close().await;
        let failure = workbench
            .import_workspace(directory.path().to_str().unwrap())
            .await
            .unwrap_err();
        assert_eq!(failure.kind, ErrorKind::StorageUnavailable);
        assert!(!failure.message.contains(directory.path().to_str().unwrap()));
        assert!(workbench.snapshot_view().metadata.workspaces.is_empty());
        let next = workbench
            .save_profile(
                serde_json::from_value(json!({"name":"blocked", "provider":"demo"})).unwrap(),
            )
            .await
            .err()
            .expect("host must reject writes");
        assert_eq!(next.kind, ErrorKind::StorageUnavailable);
        let commit = workbench
            .put_catalog_locked("profile", "blocked", json!({}))
            .await
            .unwrap_err();
        assert_eq!(commit.kind, ErrorKind::StorageUnavailable);
    }
    #[tokio::test]
    async fn legacy_profiles_and_corrupt_records_preserve_history_and_guard_removal() {
        let directory = tempfile::tempdir().unwrap();
        let store = Store::open(directory.path()).await.unwrap();
        let legacy =
            json!({"id":"legacy","name":"Legacy","provider":"demo","future":{"keep":true}});
        let corrupt =
            json!({"id":"corrupt","name":"Bad","provider":"demo","revision":4,"args":[42]});
        store
            .put_catalog("profile", "legacy", &legacy)
            .await
            .unwrap();
        store
            .put_catalog("profile", "corrupt", &corrupt)
            .await
            .unwrap();
        store
            .put_catalog(
                "profile",
                "wrong-key",
                &json!({"id":"different","name":"Mismatch","provider":"demo"}),
            )
            .await
            .unwrap();
        store.close().await;
        let provider = Provider {
            id: "demo".into(),
            name: "Demo".into(),
            available: true,
            description: "Fixture".into(),
            command: std::env::current_exe().unwrap(),
            args: vec![],
        };
        let workbench = Workbench::open(directory.path(), vec![provider.clone()])
            .await
            .unwrap();
        let snapshot = workbench.snapshot_view();
        assert_eq!(snapshot.metadata.profiles.len(), 1);
        assert_eq!(snapshot.metadata.profile_issues.len(), 2);
        assert!(snapshot.metadata.profiles[0].details.revision.is_none());
        assert_eq!(workbench.profile_value("legacy").unwrap(), legacy);
        assert_eq!(
            workbench
                .create("demo", "", Some("corrupt"))
                .await
                .unwrap_err()
                .kind,
            ErrorKind::ProfileInvalid
        );
        let id = workbench.create("demo", "", Some("legacy")).await.unwrap();
        let issue = snapshot
            .metadata
            .profile_issues
            .iter()
            .find(|issue| issue.id == "corrupt")
            .unwrap();
        let mut changed = corrupt.clone();
        changed["args"] = json!([99]);
        workbench
            .put_catalog("profile", "corrupt", changed.clone())
            .await
            .unwrap();
        let stale = serde_json::from_value(
            json!({"id":"corrupt","revision":4,"recordHash":issue.record_hash,"remove":true}),
        )
        .unwrap();
        assert!(workbench.save_profile(stale).await.is_err());
        assert_eq!(workbench.profile_value("corrupt").unwrap(), changed);
        let (_, issues) = workbench.profile_views();
        for issue in issues {
            workbench
                .save_profile(
                    serde_json::from_value(
                        json!({"id":issue.id,"recordHash":issue.record_hash,"remove":true}),
                    )
                    .unwrap(),
                )
                .await
                .unwrap();
        }
        workbench
            .save_profile(
                serde_json::from_value(json!({"id":"legacy","name":"Changed","provider":"demo"}))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            workbench.profile_view("legacy").unwrap().details.revision,
            Some(1)
        );
        let entry = workbench.entry(&id).unwrap();
        let pinned = entry.view.lock().unwrap().profile.clone().unwrap();
        assert_eq!(pinned.name.as_deref(), Some("Legacy"));
        assert!(pinned.details.revision.is_none());
        assert_eq!(pinned.details.extensions["future"], json!({"keep":true}));
        workbench
            .save_profile(
                serde_json::from_value(json!({"id":"legacy","revision":1,"remove":true})).unwrap(),
            )
            .await
            .unwrap();
        workbench.close().await;
        let reopened = Workbench::open(directory.path(), vec![provider])
            .await
            .unwrap();
        assert!(reopened.snapshot_view().metadata.profiles.is_empty());
        assert!(reopened.snapshot_view().metadata.profile_issues.is_empty());
        assert_eq!(
            reopened
                .entry(&id)
                .unwrap()
                .view
                .lock()
                .unwrap()
                .profile
                .as_ref()
                .unwrap()
                .name
                .as_deref(),
            Some("Legacy")
        );
        reopened.close().await;
    }
}
