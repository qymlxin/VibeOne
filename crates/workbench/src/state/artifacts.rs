use super::*;
impl Workbench {
    #[cfg(test)]
    pub(crate) async fn capture_artifact(
        &self,
        id: &str,
        path: &str,
    ) -> Result<Value, DomainError> {
        serde_json::to_value(self.capture_artifact_with_key(id, path, None).await?)
            .map_err(|_| DomainError::new(ErrorKind::Internal, "产物编码失败"))
    }
    pub(crate) async fn capture_artifact_with_key(
        &self,
        id: &str,
        path: &str,
        key: Option<&str>,
    ) -> Result<crate::contracts::ArtifactRecord, DomainError> {
        self.command_available()?;
        let entry = self.command_entry(id)?;
        use sha2::{Digest, Sha256};
        let hash = |value: &Value| {
            Sha256::digest(serde_json::to_vec(value).expect("JSON serializes"))
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>()
        };
        if key.is_some_and(|key| key.is_empty() || key.len() > 128) {
            return Err(DomainError::new(
                ErrorKind::InvalidInput,
                "产物幂等键须为1至128字节",
            ));
        }
        let receipt_key = key.map(|key| hash(&json!([id, key])));
        let fingerprint = hash(&json!({"path":path}));
        let _catalog = self.catalog_gate.lock().await;
        self.command_available()?;
        if let Some(key) = &receipt_key {
            let catalog = self.catalog.lock().expect("catalog poisoned");
            if let Some(saved) = catalog
                .get("artifact-command")
                .and_then(|items| items.get(key))
            {
                if saved["fingerprint"] != fingerprint {
                    return Err(DomainError::new(
                        ErrorKind::IdempotencyConflict,
                        "同一产物幂等键的参数不同",
                    ));
                }
                let record = saved["artifactId"]
                    .as_str()
                    .and_then(|artifact_id| {
                        catalog
                            .get("artifact")
                            .and_then(|items| items.get(artifact_id))
                    })
                    .cloned()
                    .ok_or_else(|| {
                        DomainError::new(ErrorKind::Internal, "产物回执指向的快照不可用")
                    })?;
                let record: crate::contracts::ArtifactRecord = serde_json::from_value(record)
                    .map_err(|_| {
                        DomainError::new(ErrorKind::Internal, "产物回执指向的快照格式无效")
                    })?;
                if record.session_id != id || saved["artifactId"] != record.id {
                    return Err(DomainError::new(ErrorKind::Internal, "产物回执身份无效"));
                }
                return Ok(record);
            }
        }
        if self.catalog("artifact").len() >= 256 {
            return Err(DomainError::new(
                ErrorKind::ArtifactLimit,
                "产物数量已达到当前版本上限",
            ));
        }
        let (workspace, run_id) = {
            let view = entry.view.lock().expect("view poisoned");
            (
                view.workspace.clone(),
                view.runs
                    .iter()
                    .rev()
                    .find(|run| run.started_at.is_some())
                    .map(|run| run.id.clone()),
            )
        };
        let content = crate::files::read(&workspace, path).await?;
        if content["binary"] == true {
            return Err(DomainError::new(
                ErrorKind::ArtifactUnsupported,
                "当前仅保存文本产物快照，二进制文件可在文件页查看大小",
            ));
        }
        let content = serde_json::from_value(content)
            .map_err(|_| DomainError::new(ErrorKind::Internal, "产物文本格式无效"))?;
        let artifact_id = uuid::Uuid::new_v4().to_string();
        let artifact = crate::contracts::ArtifactRecord {
            id: artifact_id.clone(),
            session_id: id.into(),
            run_id,
            path: path.into(),
            content,
            created_at: execution::now(),
            source: "workspace_snapshot".into(),
        };
        let value = serde_json::to_value(&artifact)
            .map_err(|_| DomainError::new(ErrorKind::Internal, "产物编码失败"))?;
        let receipt = json!({"sessionId":id,"fingerprint":fingerprint,"artifactId":artifact_id});
        self.put_catalog_with_receipt_locked(
            "artifact",
            &artifact_id,
            value,
            receipt_key
                .as_deref()
                .map(|key| ("artifact-command", key, &receipt)),
        )
        .await?;
        Ok(artifact)
    }
    pub(crate) fn artifacts(&self, id: &str) -> Result<Value, DomainError> {
        self.command_entry(id)?;
        Ok(json!(
            self.catalog("artifact")
                .into_iter()
                .filter(|artifact| artifact["sessionId"] == id)
                .collect::<Vec<_>>()
        ))
    }
}

#[cfg(test)]
mod resource_state_tests {
    use super::*;
    async fn setup() -> (tempfile::TempDir, Arc<Workbench>, String) {
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(directory.path().join("note.txt"), "snapshot text").unwrap();
        let workbench = Workbench::open(
            directory.path(),
            vec![Provider {
                id: "demo".into(),
                name: "Demo".into(),
                available: true,
                description: String::new(),
                command: PathBuf::from("unused"),
                args: vec![],
            }],
        )
        .await
        .unwrap();
        let id = workbench
            .create("demo", directory.path().to_str().unwrap(), None)
            .await
            .unwrap();
        (directory, workbench, id)
    }
    #[tokio::test]
    async fn concurrent_artifact_captures_share_the_last_capacity_slot() {
        let (_directory, workbench, id) = setup().await;
        for index in 0..255 {
            let key = format!("existing-{index}");
            workbench
                .put_catalog(
                    "artifact",
                    &key,
                    json!({"id":key,"sessionId":id,"source":"fixture"}),
                )
                .await
                .unwrap();
        }
        let results = futures_util::future::join_all(
            (0..8).map(|_| workbench.capture_artifact(&id, "note.txt")),
        )
        .await;
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert!(
            results
                .iter()
                .filter_map(|result| result.as_ref().err())
                .all(|error| error.kind == ErrorKind::ArtifactLimit)
        );
        assert_eq!(
            workbench.artifacts(&id).unwrap().as_array().unwrap().len(),
            256
        );
        assert_eq!(
            workbench
                .store
                .catalog()
                .await
                .unwrap()
                .iter()
                .filter(|(kind, _, _)| kind == "artifact")
                .count(),
            256
        );
        workbench.close().await;
    }
    #[tokio::test]
    async fn artifact_links_latest_started_run_instead_of_a_withdrawn_queue_item() {
        let (_directory, workbench, id) = setup().await;
        let entry = workbench.command_entry(&id).unwrap();
        entry.view.lock().unwrap().runs = serde_json::from_value(json!([
            {"id":"old","status":"completed","startedAt":1,"finishedAt":2},
            {"id":"started","status":"running","startedAt":3},
            {"id":"queued","status":"queued"},
            {"id":"withdrawn","status":"withdrawn","finishedAt":4}
        ]))
        .unwrap();
        let artifact = workbench
            .capture_artifact_with_key(&id, "note.txt", Some("association"))
            .await
            .unwrap();
        assert_eq!(artifact.run_id.as_deref(), Some("started"));
        workbench.close().await;
    }
    #[tokio::test]
    async fn keyed_replay_bypasses_full_quota_and_does_not_read_a_deleted_source() {
        let (directory, workbench, id) = setup().await;
        let first = workbench
            .capture_artifact_with_key(&id, "note.txt", Some("first"))
            .await
            .unwrap();
        std::fs::remove_file(directory.path().join("note.txt")).unwrap();
        for index in 0..255 {
            let key = format!("quota-{index}");
            workbench
                .put_catalog("artifact", &key, json!({"id":key,"sessionId":id}))
                .await
                .unwrap();
        }
        let replay = workbench
            .capture_artifact_with_key(&id, "note.txt", Some("first"))
            .await
            .unwrap();
        assert_eq!(replay.id, first.id);
        assert_eq!(replay.content.text, "snapshot text");
        let failure = workbench
            .capture_artifact_with_key(&id, "note.txt", Some("new"))
            .await
            .err()
            .unwrap();
        assert_eq!(failure.kind, ErrorKind::ArtifactLimit);
        assert_eq!(workbench.catalog("artifact").len(), 256);
        workbench.close().await;
    }
    #[tokio::test]
    async fn database_failures_never_publish_artifacts_or_expose_history_storage_details() {
        for action in ["artifact", "history"] {
            let (directory, workbench, id) = setup().await;
            workbench.store.close().await;
            let result = if action == "artifact" {
                workbench.capture_artifact(&id, "note.txt").await
            } else {
                workbench.history_page(&id, None, 128).await
            };
            let error = result.unwrap_err();
            assert_eq!(error.kind, ErrorKind::StorageUnavailable);
            assert!(!error.message.contains(directory.path().to_str().unwrap()));
            assert!(
                workbench
                    .artifacts(&id)
                    .unwrap()
                    .as_array()
                    .unwrap()
                    .is_empty()
            );
            assert!(workbench.snapshot()["storageError"].is_string());
            workbench.close().await;
        }
    }
}
