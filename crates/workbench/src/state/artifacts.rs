use super::*;
impl Workbench {
    pub(crate) async fn capture_artifact(&self, id: &str, path: &str) -> Result<Value, String> {
        let entry = self.entry(id)?;
        let (workspace, run_id) = {
            let view = entry.view.lock().expect("view poisoned");
            (
                view.workspace.clone(),
                view.runs.last().map(|run| run["id"].clone()),
            )
        };
        let content = crate::files::read(&workspace, path).await?;
        if content["binary"] == true {
            return Err("当前仅保存文本产物快照，二进制文件可在文件页查看大小".into());
        }
        if self.catalog("artifact").len() >= 256 {
            return Err("产物数量已达到当前版本上限".into());
        }
        let artifact_id = uuid::Uuid::new_v4().to_string();
        let artifact = json!({"id":artifact_id,"sessionId":id,"runId":run_id,"path":path,"content":content,"createdAt":execution::now(),"source":"workspace_snapshot"});
        self.put_catalog("artifact", &artifact_id, artifact.clone())
            .await?;
        Ok(artifact)
    }
    pub(crate) fn artifacts(&self, id: &str) -> Value {
        json!(
            self.catalog("artifact")
                .into_iter()
                .filter(|artifact| artifact["sessionId"] == id)
                .collect::<Vec<_>>()
        )
    }
}
