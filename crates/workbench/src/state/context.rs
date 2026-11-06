use super::*;
use crate::domain_error::{DomainError, ErrorKind};
impl Workbench {
    pub(crate) async fn resume_context(&self, id: &str) -> Result<(), DomainError> {
        self.available()
            .map_err(|_| DomainError::new(ErrorKind::HostUnavailable, "工作主机不可用"))?;
        let entry = self
            .entry(id)
            .map_err(|_| DomainError::new(ErrorKind::SessionNotFound, "会话不存在"))?;
        let _gate = entry.gate.lock().await;
        self.available()
            .map_err(|_| DomainError::new(ErrorKind::HostUnavailable, "工作主机不可用"))?;
        let mut view = entry.view.lock().expect("view poisoned").clone();
        if view.active || view.archived || !view.history_only {
            return Err(DomainError::new(
                ErrorKind::ContextConflict,
                "仅可在已停止的历史会话中选择原上下文",
            ));
        }
        let upstream = view.agent_state["upstreamSessionId"]
            .as_str()
            .filter(|value| !value.is_empty() && value.len() <= 4096)
            .ok_or_else(|| {
                DomainError::new(
                    ErrorKind::ContextConflict,
                    "缺少可恢复的Agent身份，请选择新上下文继续",
                )
            })?
            .to_owned();
        if !view.agent_state["capabilities"]["session"].is_object() {
            return Err(DomainError::new(
                ErrorKind::ContextConflict,
                "旧记录未确认v2会话能力，请选择新上下文继续",
            ));
        }
        if !view.agent_state["reconnectConfigOptions"].is_array()
            && view.agent_state["configOptions"].is_array()
        {
            view.agent_state["reconnectConfigOptions"] = view.agent_state["configOptions"].clone();
        }
        view.agent_state["resumeSessionId"] = json!(upstream);
        view.agent_state["contextRestoreState"] = json!("pending");
        view.agent_state
            .as_object_mut()
            .expect("agent state object")
            .remove("contextRestartedAt");
        view.history_only = false;
        view.status = "idle".into();
        view.error = None;
        view.queue_paused = !view.queue.is_empty();
        self.commit(
            &entry,
            view,
            "session.context_selected",
            &json!({"mode":"upstream"}),
        )
        .await
        .map_err(|_| DomainError::storage())?;
        // Selecting context never starts an Agent or promotes queued work.
        Ok(())
    }
}
