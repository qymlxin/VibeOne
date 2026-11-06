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
    pub(crate) fn operation(&self, id: &str) -> Result<Value, String> {
        let mut record = self
            .catalog("operation")
            .into_iter()
            .find(|item| item["id"] == id)
            .ok_or("操作记录不存在")?;
        record.as_object_mut().unwrap().remove("fingerprint");
        Ok(record)
    }
    pub(crate) async fn submit_plugin_operation(
        self: &Arc<Self>,
        plugin: &str,
        mut body: Value,
    ) -> Result<Value, String> {
        self.available()?;
        let key = body["key"]
            .as_str()
            .filter(|key| !key.is_empty() && key.len() <= 128)
            .ok_or("操作幂等键必须为1至128字节")?
            .to_owned();
        body.as_object_mut()
            .ok_or("操作参数必须为对象")?
            .remove("key");
        let request = serde_json::to_vec(&json!({"pluginId":plugin,"request":body}))
            .map_err(|e| e.to_string())?;
        if request.len() > 512 * 1024 {
            return Err("插件操作输入超过512KiB".into());
        }
        let fingerprint = Sha256::digest(request)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        let _gate = self.operation_gate.lock().await;
        self.available()?;
        let records = self.catalog("operation");
        if let Some(record) = records.iter().find(|record| record["key"] == key) {
            if record["fingerprint"] != fingerprint {
                return Err("同一幂等键的插件操作内容不同".into());
            }
            return Ok(json!({"operationId":record["id"],"state":record["state"]}));
        }
        if records
            .iter()
            .filter(|record| matches!(record["state"].as_str(), Some("accepted" | "running")))
            .count()
            >= 32
        {
            return Err("插件后台操作已达到并发上限32".into());
        }
        let prepared = self.plugins.prepare_invocation(self, plugin, &body).await?;
        let id = uuid::Uuid::new_v4().to_string();
        let record = json!({"id":id,"key":key,"fingerprint":fingerprint,"pluginId":plugin,"generation":prepared.generation(),"handler":body["handler"],"title":prepared.title,"pluginName":prepared.plugin_name,"workspaceId":body["workspaceId"],"state":"accepted","createdAt":execution::now()});
        self.put_catalog("operation", &id, record.clone()).await?;
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
            let result = job
                .await
                .unwrap_or_else(|_| Err("插件操作执行任务异常结束".into()));
            match result {
                Ok(value) => {
                    record["state"] = json!("succeeded");
                    record["result"] = value;
                }
                Err(message) => {
                    record["state"] = json!("failed");
                    record["error"] = json!({"code":"PLUGIN_OPERATION_FAILED","message":message.chars().take(2000).collect::<String>()});
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
