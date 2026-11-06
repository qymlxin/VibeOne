//! Durable receipts for trusted local plugin commands; interrupted work is never replayed.
use super::*;
use sha2::{Digest, Sha256};

impl Workbench {
    pub(crate) fn operation_summaries(&self) -> Vec<Value> {
        let mut records = self.catalog("operation");
        records.sort_by_key(|record| std::cmp::Reverse(record["createdAt"].as_u64().unwrap_or(0)));
        let mut terminal = 0;
        records
            .into_iter()
            .filter_map(|mut record| {
                if !matches!(record["state"].as_str(), Some("accepted" | "running")) {
                    terminal += 1;
                    if terminal > 100 {
                        return None;
                    }
                }
                if let Some(object) = record.as_object_mut() {
                    object.remove("result");
                    object.remove("fingerprint");
                }
                Some(record)
            })
            .collect()
    }
    pub(crate) fn operation(&self, id: &str) -> Result<Value, DomainError> {
        let mut record = self
            .catalog("operation")
            .into_iter()
            .find(|item| item["id"] == id)
            .ok_or_else(|| DomainError::new(ErrorKind::OperationNotFound, "操作记录不存在"))?;
        record
            .as_object_mut()
            .ok_or_else(|| DomainError::new(ErrorKind::Internal, "操作记录格式无效"))?
            .remove("fingerprint");
        Ok(record)
    }
    pub(crate) async fn submit_plugin_operation(
        self: &Arc<Self>,
        plugin: &str,
        mut body: Value,
    ) -> Result<Value, DomainError> {
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
        let records = self.catalog("operation");
        if let Some(record) = records.iter().find(|record| record["key"] == key) {
            if record["fingerprint"] != fingerprint {
                return Err(DomainError::new(
                    ErrorKind::IdempotencyConflict,
                    "同一幂等键的插件操作内容不同",
                ));
            }
            return Ok(json!({"operationId":record["id"],"state":record["state"]}));
        }
        if records
            .iter()
            .filter(|record| matches!(record["state"].as_str(), Some("accepted" | "running")))
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
        let record = json!({"id":id,"key":key,"fingerprint":fingerprint,"pluginId":plugin,"generation":prepared.generation(),"handler":body["handler"],"title":prepared.title,"pluginName":prepared.plugin_name,"workspaceId":body["workspaceId"],"state":"accepted","createdAt":execution::now()});
        self.save_catalog("operation", &id, record.clone()).await?;
        let receipt = json!({"operationId":id,"state":"accepted"});
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
            let job = tokio::spawn(async move { prepared.execute().await });
            let result = job.await.unwrap_or_else(|_| {
                Err(DomainError::new(
                    ErrorKind::PluginOperationFailed,
                    "插件操作执行任务异常结束",
                ))
            });
            match result {
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
        Ok(receipt)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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
        assert_eq!(record["state"], "interrupted");
        assert_eq!(record["error"]["code"], "STORAGE_UNAVAILABLE");
        assert!(workbench.snapshot()["storageError"].is_string());
    }
}
