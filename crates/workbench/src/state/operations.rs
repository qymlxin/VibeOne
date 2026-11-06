//! Durable receipts for trusted local plugin commands; interrupted work is never replayed.
use super::*;
use crate::contracts::{
    PluginLifecycleAction, PluginLifecycleRequest, PluginOperationError, PluginOperationReceipt,
    PluginOperationRecord, PluginOperationSummary,
};
use sha2::{Digest, Sha256};

impl Workbench {
    fn operation_records(&self) -> Vec<(String, Value)> {
        let catalog = self.catalog.lock().expect("catalog poisoned");
        let mut records: Vec<_> = catalog
            .get("operation")
            .into_iter()
            .flatten()
            .map(|(id, record)| (id.clone(), record.clone()))
            .collect();
        records.sort_by(|a, b| a.0.cmp(&b.0));
        records
    }
    pub(crate) fn operation_summaries(&self) -> Vec<PluginOperationSummary> {
        let mut records = self.operation_records();
        records.sort_by_key(|(_, record)| {
            std::cmp::Reverse(record["createdAt"].as_u64().unwrap_or(0))
        });
        let mut terminal = 0;
        records
            .into_iter()
            .filter_map(|(id, record)| {
                if !matches!(record["state"].as_str(), Some("accepted" | "running")) {
                    terminal += 1;
                    if terminal > 100 {
                        return None;
                    }
                }
                Some(operation_summary(&id, &record))
            })
            .collect()
    }
    pub(crate) fn operation(&self, id: &str) -> Result<PluginOperationRecord, DomainError> {
        let record = self
            .operation_records()
            .into_iter()
            .find(|(key, _)| key == id)
            .map(|(_, record)| record)
            .ok_or_else(|| DomainError::new(ErrorKind::OperationNotFound, "操作记录不存在"))?;
        if !record.is_object() || record["id"] != id || !record["state"].is_string() {
            return Err(DomainError::new(
                ErrorKind::Internal,
                "操作记录身份或状态格式无效",
            ));
        }
        Ok(PluginOperationRecord {
            summary: operation_summary(id, &record),
            result: record.get("result").cloned(),
        })
    }
    pub(crate) async fn submit_plugin_operation(
        self: &Arc<Self>,
        plugin: &str,
        mut body: Value,
    ) -> Result<PluginOperationReceipt, DomainError> {
        self.command_available()?;
        let key = body["key"]
            .as_str()
            .filter(|key| !key.is_empty() && key.len() <= 128)
            .ok_or_else(|| DomainError::new(ErrorKind::InvalidInput, "操作幂等键必须为1至128字节"))?
            .to_owned();
        body.as_object_mut()
            .ok_or_else(|| DomainError::new(ErrorKind::InvalidInput, "操作参数必须为对象"))?
            .remove("key");
        let request = serde_json::to_vec(&json!({"pluginId":plugin,"request":body}))
            .map_err(|_| DomainError::new(ErrorKind::Internal, "插件操作参数序列化失败"))?;
        if request.len() > 512 * 1024 {
            return Err(DomainError::new(
                ErrorKind::InvalidInput,
                "插件操作输入超过512KiB",
            ));
        }
        let fingerprint = Sha256::digest(request)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        let _gate = self.operation_gate.lock().await;
        self.command_available()?;
        let records = self.operation_records();
        if let Some((id, record)) = records.iter().find(|(_, record)| record["key"] == key) {
            if record["fingerprint"] != fingerprint {
                return Err(DomainError::new(
                    ErrorKind::IdempotencyConflict,
                    "同一幂等键的插件操作内容不同",
                ));
            }
            if record["id"] != *id {
                return Err(DomainError::new(ErrorKind::Internal, "操作回执身份无效"));
            }
            let state = record["state"]
                .as_str()
                .ok_or_else(|| DomainError::new(ErrorKind::Internal, "操作回执状态无效"))?;
            return Ok(PluginOperationReceipt {
                operation_id: id.clone(),
                state: state.to_owned(),
            });
        }
        if records
            .iter()
            .filter(|(_, record)| matches!(record["state"].as_str(), Some("accepted" | "running")))
            .count()
            >= 32
        {
            return Err(DomainError::new(
                ErrorKind::OperationLimit,
                "插件后台操作已达到并发上限32",
            ));
        }
        let prepared = self.plugins.prepare_invocation(self, plugin, &body).await?;
        let id = uuid::Uuid::new_v4().to_string();
        let record = json!({"id":id,"key":key,"fingerprint":fingerprint,"kind":"plugin.command","pluginId":plugin,"generation":prepared.generation(),"handler":body["handler"],"title":prepared.title,"pluginName":prepared.plugin_name,"workspaceId":body["workspaceId"],"state":"accepted","createdAt":execution::now()});
        self.save_catalog("operation", &id, record.clone()).await?;
        let receipt = PluginOperationReceipt {
            operation_id: id.clone(),
            state: "accepted".into(),
        };
        self.start_operation(id, record, async move { prepared.execute().await });
        Ok(receipt)
    }
    fn start_operation(
        self: &Arc<Self>,
        id: String,
        record: Value,
        work: impl std::future::Future<Output = Result<Value, DomainError>> + Send + 'static,
    ) {
        let workbench = self.clone();
        tokio::spawn(async move {
            let mut record = record;
            record["state"] = json!("running");
            if workbench
                .put_catalog("operation", &id, record.clone())
                .await
                .is_err()
            {
                return;
            }
            match tokio::spawn(work).await.unwrap_or_else(|_| {
                Err(DomainError::new(
                    ErrorKind::PluginOperationFailed,
                    "后台操作执行任务异常结束",
                ))
            }) {
                Ok(value) => {
                    record["state"] = json!("succeeded");
                    record["result"] = value;
                }
                Err(error) => {
                    record["state"] = json!("failed");
                    record["error"] = json!({"code":error.kind.code(),"message":error.message});
                }
            }
            record["finishedAt"] = json!(execution::now());
            let _ = workbench.put_catalog("operation", &id, record).await;
        });
    }
    pub(crate) async fn submit_plugin_lifecycle(
        self: &Arc<Self>,
        request: PluginLifecycleRequest,
    ) -> Result<PluginOperationReceipt, DomainError> {
        use PluginLifecycleAction::*;
        self.command_available()?;
        if request.key.is_empty() || request.key.len() > 128 {
            return Err(DomainError::new(
                ErrorKind::InvalidInput,
                "操作幂等键必须为1至128字节",
            ));
        }
        let field = match request.action {
            Inspect | Prepare => "path",
            Commit | Discard => "ticket",
            Disable => "id",
        };
        let target = request.input[field]
            .as_str()
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                DomainError::new(ErrorKind::InvalidInput, "插件管理操作缺少有效目标参数")
            })?
            .to_owned();
        if !request.input.is_object() {
            return Err(DomainError::new(
                ErrorKind::InvalidInput,
                "插件管理参数须为对象",
            ));
        }
        if matches!(request.action, Prepare) && request.input["trusted"] != true {
            return Err(DomainError::new(
                ErrorKind::PluginTrustRequired,
                "请先确认信任此插件",
            ));
        }
        let bytes = serde_json::to_vec(
            &json!({"kind":"plugin.lifecycle","action":request.action,"input":request.input}),
        )
        .map_err(|_| DomainError::new(ErrorKind::Internal, "插件管理请求序列化失败"))?;
        if bytes.len() > 512 * 1024 {
            return Err(DomainError::new(
                ErrorKind::InvalidInput,
                "插件管理输入超过512KiB",
            ));
        }
        let fingerprint = Sha256::digest(bytes)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        let _gate = self.operation_gate.lock().await;
        self.command_available()?;
        let records = self.operation_records();
        if let Some((id, record)) = records
            .iter()
            .find(|(_, record)| record["key"] == request.key)
        {
            if record["fingerprint"] != fingerprint {
                return Err(DomainError::new(
                    ErrorKind::IdempotencyConflict,
                    "同一幂等键的插件操作内容不同",
                ));
            }
            if record["id"] != *id {
                return Err(DomainError::new(ErrorKind::Internal, "操作回执身份无效"));
            }
            let state = record["state"]
                .as_str()
                .ok_or_else(|| DomainError::new(ErrorKind::Internal, "操作回执状态无效"))?;
            return Ok(PluginOperationReceipt {
                operation_id: id.clone(),
                state: state.to_owned(),
            });
        }
        if records
            .iter()
            .filter(|(_, record)| matches!(record["state"].as_str(), Some("accepted" | "running")))
            .count()
            >= 32
        {
            return Err(DomainError::new(
                ErrorKind::OperationLimit,
                "插件后台操作已达到并发上限32",
            ));
        }
        let title = match request.action {
            Inspect => "检查插件",
            Prepare => "准备插件候选",
            Commit => "发布插件候选",
            Discard => "丢弃插件候选",
            Disable => "停用插件",
        };
        let id = uuid::Uuid::new_v4().to_string();
        let record = json!({"id":id,"key":request.key,"fingerprint":fingerprint,"kind":"plugin.lifecycle","handler":request.action,"title":title,"pluginId":if matches!(request.action,Disable){Some(target.clone())}else{None},"state":"accepted","createdAt":execution::now()});
        self.save_catalog("operation", &id, record.clone()).await?;
        let workbench = self.clone();
        self.start_operation(id.clone(), record, async move {
            match request.action {
                Inspect => crate::plugins::inspect(PathBuf::from(target)).await,
                Prepare => workbench.plugins.prepare(&workbench, request.input).await,
                Commit => workbench.plugins.commit(&workbench, &target).await,
                Discard => {
                    workbench.plugins.discard(&target);
                    Ok(json!({"discarded":true}))
                }
                Disable => {
                    workbench.plugins.disable(&workbench, &target).await?;
                    Ok(json!({"disabled":true}))
                }
            }
        });
        Ok(PluginOperationReceipt {
            operation_id: id,
            state: "accepted".into(),
        })
    }
}

fn operation_summary(id: &str, record: &Value) -> PluginOperationSummary {
    let invalid = record["id"] != id || !record["state"].is_string();
    let invalid_error = || PluginOperationError {
        code: "OPERATION_RECORD_INVALID".into(),
        message: "操作记录格式异常，请核对诊断；不要直接重复执行。".into(),
    };
    let error = if invalid {
        Some(invalid_error())
    } else {
        record
            .get("error")
            .filter(|value| !value.is_null())
            .map(|value| serde_json::from_value(value.clone()).unwrap_or_else(|_| invalid_error()))
    };
    let text = |key: &str| record[key].as_str().map(str::to_owned);
    PluginOperationSummary {
        id: id.to_owned(),
        kind: text("kind"),
        state: text("state").unwrap_or_else(|| "invalid".into()),
        key: text("key"),
        plugin_id: text("pluginId"),
        plugin_name: text("pluginName"),
        generation: record["generation"].as_u64(),
        handler: text("handler"),
        title: text("title"),
        workspace_id: text("workspaceId"),
        created_at: record["createdAt"].as_u64(),
        finished_at: record["finishedAt"].as_u64(),
        error,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn lifecycle_receipts_obey_storage_failure_capacity_and_restart_rules() {
        let directory = tempfile::tempdir().unwrap();
        let workbench = Workbench::open(directory.path(), vec![]).await.unwrap();
        for index in 0..32 {
            let id = format!("active-{index}");
            workbench
                .save_catalog(
                    "operation",
                    &id,
                    json!({"id":id,"kind":"plugin.lifecycle","state":"accepted"}),
                )
                .await
                .unwrap();
        }
        let request = || PluginLifecycleRequest {
            key: "new".into(),
            action: PluginLifecycleAction::Inspect,
            input: json!({"path":"/missing"}),
        };
        assert_eq!(
            workbench
                .submit_plugin_lifecycle(request())
                .await
                .unwrap_err()
                .kind,
            ErrorKind::OperationLimit
        );
        workbench.close().await;
        let restored = Workbench::open(directory.path(), vec![]).await.unwrap();
        assert!(
            restored
                .catalog("operation")
                .iter()
                .all(|record| record["state"] == "interrupted"
                    && record["kind"] == "plugin.lifecycle")
        );
        restored.store.close().await;
        assert_eq!(
            restored
                .submit_plugin_lifecycle(request())
                .await
                .unwrap_err()
                .kind,
            ErrorKind::StorageUnavailable
        );
        assert!(
            !restored
                .catalog("operation")
                .iter()
                .any(|record| record["key"] == "new")
        );
        restored.close().await;
    }

    #[tokio::test]
    async fn operation_public_records_preserve_results_without_private_storage_fields() {
        let directory = tempfile::tempdir().unwrap();
        let workbench = Workbench::open(directory.path(), vec![]).await.unwrap();
        for (index, result) in [
            Value::Null,
            json!(false),
            json!(0),
            json!({"nested":[1,false,null]}),
        ]
        .into_iter()
        .enumerate()
        {
            let id = format!("result-{index}");
            workbench.save_catalog("operation",&id,json!({"id":id,"state":"succeeded","result":result,"fingerprint":"PRIVATE_FINGERPRINT","futurePrivate":"PRIVATE_NEW_FIELD"})).await.unwrap();
            let detail = serde_json::to_value(workbench.operation(&id).unwrap()).unwrap();
            assert!(
                detail.get("result").is_some(),
                "null result is different from an absent result"
            );
            assert_eq!(detail["result"], result);
            assert!(!detail.to_string().contains("PRIVATE_"));
        }
        let summaries = serde_json::to_value(workbench.operation_summaries()).unwrap();
        assert!(!summaries.to_string().contains("PRIVATE_"));
        assert!(
            summaries
                .as_array()
                .unwrap()
                .iter()
                .all(|record| record.get("result").is_none())
        );
        workbench.close().await;
    }

    #[tokio::test]
    async fn operation_projection_keeps_directory_identity_and_missing_metadata_explicit() {
        let directory = tempfile::tempdir().unwrap();
        let workbench = Workbench::open(directory.path(), vec![]).await.unwrap();
        workbench
            .save_catalog(
                "operation",
                "real",
                json!({"id":"wrong","state":"running","result":"PRIVATE"}),
            )
            .await
            .unwrap();
        let summaries = workbench.operation_summaries();
        assert_eq!(summaries[0].id, "real");
        assert_eq!(
            summaries[0].state, "running",
            "uncertain metadata must not release active-work protection"
        );
        assert_eq!(
            summaries[0].error.as_ref().unwrap().code,
            "OPERATION_RECORD_INVALID"
        );
        assert!(workbench.operation("real").is_err());
        workbench
            .save_catalog("operation", "real", json!({"id":"real","state":"future"}))
            .await
            .unwrap();
        let value = serde_json::to_value(workbench.operation("real").unwrap()).unwrap();
        assert_eq!(value["state"], "future");
        assert!(value.get("createdAt").is_none());
        assert!(value.get("result").is_none());
        let schema = crate::contracts::schemas()["PluginOperationRecord"].clone();
        assert!(jsonschema::validator_for(&schema).unwrap().is_valid(&value));
        workbench.close().await;
    }

    #[tokio::test]
    async fn plugin_publication_and_acceptance_keep_storage_failures_atomic() {
        for action in ["publish", "operation"] {
            let directory = tempfile::tempdir().unwrap();
            let source = directory.path().join("source");
            std::fs::create_dir(&source).unwrap();
            std::fs::write(source.join("plugin.json"), serde_json::to_vec(&json!({"manifestVersion":1,"id":"fixture.storage","name":"Fixture","version":"0.1.0","engines":{"pluginApi":">=0.1 <0.2"},"entrypoints":{"worker":{"path":"worker.mjs","runtime":"node","protocolVersion":1}},"contributions":[{"id":"run","kind":"app.command","kindVersion":1,"binding":{"type":"worker","handler":"run"}}]})).unwrap()).unwrap();
            std::fs::write(
                source.join("worker.mjs"),
                "export default {apiVersion:'0.1',setup(r){r.handle('run',async()=>true);}};",
            )
            .unwrap();
            let workbench = Workbench::open(directory.path(), vec![]).await.unwrap();
            let prepared = workbench
                .plugins
                .prepare(&workbench, json!({"path":source,"trusted":true}))
                .await
                .unwrap();
            let ticket = prepared["ticket"].as_str().unwrap();
            if action == "operation" {
                workbench.plugins.commit(&workbench, ticket).await.unwrap();
            }
            workbench.store.close().await;
            let error = if action == "publish" {
                workbench
                    .plugins
                    .commit(&workbench, ticket)
                    .await
                    .unwrap_err()
            } else {
                workbench
                    .submit_plugin_operation(
                        "fixture.storage",
                        json!({"key":"storage","handler":"run","input":{}}),
                    )
                    .await
                    .unwrap_err()
            };
            assert_eq!(error.kind, ErrorKind::StorageUnavailable);
            assert!(!error.message.contains(directory.path().to_str().unwrap()));
            assert!(workbench.catalog("operation").is_empty());
            if action == "publish" {
                assert!(workbench.catalog("plugin").is_empty());
                assert!(workbench.plugins.acquire("fixture.storage").is_err());
            }
            assert_eq!(
                workbench
                    .plugins
                    .disable(&workbench, "fixture.storage")
                    .await
                    .unwrap_err()
                    .kind,
                ErrorKind::StorageUnavailable
            );
            workbench.close().await;
        }
    }
    #[tokio::test]
    async fn operation_capacity_is_checked_before_any_worker_or_receipt_is_created() {
        let directory = tempfile::tempdir().unwrap();
        let workbench = Workbench::open(directory.path(), vec![]).await.unwrap();
        for index in 0..32 {
            let id = format!("operation-{index}");
            workbench
                .save_catalog("operation", &id, json!({"id":id,"state":"running"}))
                .await
                .unwrap();
        }
        let error = workbench
            .submit_plugin_operation("missing", json!({"key":"new","handler":"run"}))
            .await
            .unwrap_err();
        assert_eq!(error.kind, ErrorKind::OperationLimit);
        assert_eq!(workbench.catalog("operation").len(), 32);
        workbench.close().await;
    }
    #[tokio::test]
    async fn storage_failure_exposes_uncertainty_instead_of_an_unfinishable_busy_receipt() {
        let directory = tempfile::tempdir().unwrap();
        let workbench = Workbench::open(directory.path(), vec![]).await.unwrap();
        workbench
            .put_catalog(
                "operation",
                "pending",
                json!({"id":"pending","state":"running"}),
            )
            .await
            .unwrap();
        workbench.store.close().await;
        assert!(
            workbench
                .put_catalog("profile", "trigger", json!({"id":"trigger"}))
                .await
                .is_err()
        );
        let record = workbench.operation("pending").unwrap();
        assert_eq!(record.summary.state, "interrupted");
        assert_eq!(record.summary.error.unwrap().code, "STORAGE_UNAVAILABLE");
        assert!(workbench.snapshot()["storageError"].is_string());
    }
}
