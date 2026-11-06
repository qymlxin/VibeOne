use super::*;
impl Workbench {
    pub(crate) async fn capture_artifact(
        &self,
        id: &str,
        path: &str,
    ) -> Result<Value, DomainError> {
        self.command_available()?;
        let entry = self.command_entry(id)?;
        let (workspace, run_id) = {
            let view = entry.view.lock().expect("view poisoned");
            (
                view.workspace.clone(),
                view.runs.last().map(|run| json!(run.id)),
            )
        };
        let content = crate::files::read(&workspace, path).await?;
        if content["binary"] == true {
            return Err(DomainError::new(
                ErrorKind::ArtifactUnsupported,
                "当前仅保存文本产物快照，二进制文件可在文件页查看大小",
            ));
        }
        let _catalog = self.catalog_gate.lock().await;
        self.command_available()?;
        if self.catalog("artifact").len() >= 256 {
            return Err(DomainError::new(
                ErrorKind::ArtifactLimit,
                "产物数量已达到当前版本上限",
            ));
        }
        let artifact_id = uuid::Uuid::new_v4().to_string();
        let artifact = json!({"id":artifact_id,"sessionId":id,"runId":run_id,"path":path,"content":content,"createdAt":execution::now(),"source":"workspace_snapshot"});
        self.put_catalog_locked("artifact", &artifact_id, artifact.clone())
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
