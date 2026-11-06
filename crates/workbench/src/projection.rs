use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionView {
    pub id: String,
    pub title: String,
    pub workspace: String,
    pub provider: String,
    pub status: String,
    pub messages: Vec<Value>,
    pub tools: Vec<Value>,
    pub approvals: Vec<Value>,
    #[serde(default)]
    pub inputs: Vec<Value>,
    pub error: Option<String>,
    pub stop_reason: Option<String>,
    #[serde(default)]
    pub history_only: bool,
    #[serde(default)]
    pub archived: bool,
    #[serde(default)]
    pub runs: Vec<Value>,
    #[serde(default)]
    pub queue: Vec<Value>,
    #[serde(default)]
    pub queue_paused: bool,
    #[serde(default)]
    pub decisions: Vec<Value>,
    #[serde(default)]
    pub profile: Option<Value>,
    #[serde(skip)]
    pub active: bool,
    #[serde(skip)]
    pub observed_active: bool,
}

impl SessionView {
    pub fn apply(&mut self, event: &Value) {
        match event["type"].as_str() {
            Some("update") => self.update(&event["notification"]["update"]),
            Some("input") => {
                let mut request = event["request"].clone();
                request["id"] = event["id"].clone();
                self.inputs.push(request);
            }
            Some("input_resolved") => self.inputs.retain(|input| input["id"] != event["id"]),
            Some("permission") => {
                let mut request = event["request"].clone();
                request["id"] = event["id"].clone();
                self.approvals.push(request);
                self.status = "requires_action".into();
                self.observed_active = true;
            }
            Some("permission_resolved") => self
                .approvals
                .retain(|request| request["id"] != event["id"]),
            Some("disconnected") => {
                self.active = false;
                self.approvals.clear();
                self.inputs.clear();
                self.status = "disconnected".into();
                self.error = Some(
                    event["error"]
                        .as_str()
                        .unwrap_or("Agent 连接已断开，请新建会话重试")
                        .chars()
                        .take(4000)
                        .collect(),
                );
            }
            _ => {}
        }
    }

    fn update(&mut self, update: &Value) {
        let kind = update["sessionUpdate"].as_str().unwrap_or("");
        if kind == "state_update" {
            match update["state"].as_str() {
                Some("idle") if self.observed_active => {
                    self.status = "idle".into();
                    self.active = false;
                    self.stop_reason = update["stopReason"].as_str().map(str::to_owned);
                    if update["stopReason"] == "error" {
                        self.status = "error".into();
                        self.error = Some(
                            update["error"]["message"]
                                .as_str()
                                .unwrap_or("Agent 报告执行失败，请检查本机工具认证、模型配置或网络")
                                .chars()
                                .take(4000)
                                .collect(),
                        );
                    }
                    self.approvals.clear();
                    self.inputs.clear();
                }
                Some("idle") => {} // A ready-state update is not completion of a newly submitted prompt.
                Some(state) => {
                    self.observed_active = true;
                    self.status = if state == "requires_action" {
                        "requires_action"
                    } else {
                        "running"
                    }
                    .into();
                }
                _ => {}
            }
        } else if [
            "user_message",
            "agent_message",
            "agent_message_chunk",
            "agent_thought",
            "agent_thought_chunk",
            "user_message_chunk",
        ]
        .contains(&kind)
        {
            let role = if kind.starts_with("user_") {
                "user"
            } else if kind.starts_with("agent_thought") {
                "thought"
            } else {
                "assistant"
            };
            let Some(id) = update["messageId"].as_str() else {
                return;
            };
            if role == "user" {
                self.messages.retain(|message| message["pending"] != true);
            }
            let index = match self
                .messages
                .iter()
                .position(|message| message["id"] == id && message["role"] == role)
            {
                Some(index) => index,
                None => {
                    self.messages.push(json!({"id":id,"role":role,"text":""}));
                    self.messages.len() - 1
                }
            };
            let message = &mut self.messages[index];
            if let Some(content) = update.get("content") {
                let text = text_content(content);
                let text = if kind.ends_with("_chunk") {
                    format!("{}{}", message["text"].as_str().unwrap_or(""), text)
                } else {
                    text
                };
                message["text"] = Value::String(text.chars().take(65_536).collect());
            }
            if self.messages.len() > 128 {
                self.messages.remove(0);
            }
        } else if kind == "tool_call_update" {
            let Some(id) = update["toolCallId"].as_str() else {
                return;
            };
            if let Some(tool) = self.tools.iter_mut().find(|tool| tool["toolCallId"] == id) {
                if let Some(patch) = update.as_object() {
                    for (key, value) in patch {
                        tool[key] = value.clone();
                    }
                }
            } else {
                self.tools.push(update.clone());
            }
            if self.tools.len() > 100 {
                self.tools.remove(0);
            }
        }
    }
}

fn text_content(content: &Value) -> String {
    if let Some(blocks) = content.as_array() {
        return blocks.iter().map(text_content).collect::<Vec<_>>().join("");
    }
    if content.is_null() {
        return String::new();
    }
    if content["type"] == "text" {
        content["text"].as_str().unwrap_or("").into()
    } else {
        format!(
            "\n[{}]\n",
            content["type"].as_str().unwrap_or("暂不支持的内容")
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn view() -> SessionView {
        SessionView {
            id: "a".into(),
            title: "a".into(),
            workspace: "/".into(),
            provider: "demo".into(),
            status: "starting".into(),
            messages: vec![],
            tools: vec![],
            approvals: vec![],
            inputs: vec![],
            error: None,
            stop_reason: None,
            history_only: false,
            archived: false,
            runs: vec![],
            queue: vec![],
            queue_paused: false,
            decisions: vec![],
            profile: None,
            active: true,
            observed_active: false,
        }
    }
    #[test]
    fn idle_error_retains_the_protocol_failure_details() {
        let mut view = view();
        view.update(&json!({"sessionUpdate":"state_update","state":"running"}));
        view.update(&json!({"sessionUpdate":"state_update","state":"idle","stopReason":"error","error":{"code":-32000,"message":"Authentication required"}}));
        assert_eq!(view.status, "error");
        assert_eq!(view.error.as_deref(), Some("Authentication required"));
        assert!(!view.active);
    }
    #[test]
    fn early_idle_does_not_complete_prompt_and_message_snapshots_replace_chunks() {
        let mut view = view();
        view.update(&json!({"sessionUpdate":"state_update","state":"idle"}));
        assert!(view.active);
        view.update(&json!({"sessionUpdate":"state_update","state":"running"}));
        view.update(&json!({"sessionUpdate":"agent_message_chunk","messageId":"m","content":{"type":"text","text":"hi"}}));
        view.update(&json!({"sessionUpdate":"agent_message","messageId":"m","content":[{"type":"text","text":"hi"}]}));
        assert_eq!(view.messages[0]["text"], "hi");
        view.update(&json!({"sessionUpdate":"agent_thought","messageId":"m","content":[{"type":"text","text":"thought"}]}));
        assert_eq!(view.messages.len(), 2);
        view.update(&json!({"sessionUpdate":"agent_message","messageId":"m"}));
        assert_eq!(view.messages[0]["text"], "hi");
        view.update(&json!({"sessionUpdate":"agent_message","messageId":"m","content":null}));
        assert_eq!(view.messages[0]["text"], "");
        view.update(
            &json!({"sessionUpdate":"state_update","state":"idle","stopReason":"end_turn"}),
        );
        assert!(!view.active);
    }
}
