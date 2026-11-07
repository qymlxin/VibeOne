//! Project collaboration state. All writes and routing remain inside the Host.
use super::*;
use std::collections::{HashSet, VecDeque};
fn invalid(message: &str) -> DomainError {
    DomainError::new(ErrorKind::InvalidInput, message)
}
fn field<'a>(body: &'a Value, key: &str) -> Result<&'a str, DomainError> {
    body[key]
        .as_str()
        .filter(|s| !s.trim().is_empty() && s.len() <= 128)
        .ok_or_else(|| invalid("缺少有效标识或名称"))
}
fn named(body: &Value) -> Result<String, DomainError> {
    Ok(field(body, "name")?.trim().to_owned())
}
impl Workbench {
    pub(crate) fn space_catalog(&self) -> Value {
        json!({"agents":self.catalog("space-agent"),"threads":self.catalog("space-thread"),"groups":self.catalog("space-display"),"presets":self.catalog("space-preset")})
    }
    fn space_item(&self, kind: &str, id: &str) -> Result<Value, DomainError> {
        self.catalog(kind)
            .into_iter()
            .find(|v| v["id"] == id)
            .ok_or_else(|| invalid("空间对象不存在，请刷新"))
    }
    async fn space_title(&self, id: &str, title: String) -> Result<(), DomainError> {
        self.metadata_command(
            id,
            crate::contracts::UpdateSessionRequest {
                title: Some(title),
                archived: None,
                key: None,
            },
        )
        .await
    }
    async fn append_space_message(
        &self,
        id: &str,
        role: &str,
        text: &str,
        agent: Option<&Value>,
        message_id: Option<&str>,
    ) -> Result<(), DomainError> {
        let entry = self.command_entry(id)?;
        let _gate = entry.gate.lock().await;
        let mut view = entry.view.lock().expect("view").clone();
        let mut message = json!({"id":message_id.map(str::to_owned).unwrap_or_else(||uuid::Uuid::new_v4().to_string()),"role":role,"text":text,"timestamp":execution::now()});
        if let Some(agent) = agent {
            message["agentId"] = agent["id"].clone();
            message["agentName"] = agent["name"].clone();
        }
        view.messages.push(message);
        self.commit(&entry, view, "space.message", &json!({"role":role}))
            .await
            .map_err(|_| DomainError::storage())
    }
    async fn make_space_agent(
        &self,
        project: &Value,
        body: &Value,
        steward: bool,
    ) -> Result<Value, DomainError> {
        let id = if steward {
            format!("steward:{}", field(project, "id")?)
        } else {
            body["id"].as_str().unwrap_or("").to_owned()
        };
        if id.is_empty() || id.len() > 128 {
            return Err(invalid("Agent标识无效"));
        }
        if let Ok(existing) = self.space_item("space-agent", &id) {
            if existing["projectId"] != project["id"] {
                return Err(invalid("Agent标识属于其他项目"));
            }
            return Ok(existing);
        }
        let provider = if steward {
            "codex"
        } else {
            body["provider"].as_str().unwrap_or("codex")
        };
        let profile = if steward {
            None
        } else {
            body["profileId"].as_str()
        };
        let name = if steward {
            "管家".into()
        } else {
            named(body)?
        };
        if self
            .catalog("space-agent")
            .iter()
            .any(|a| a["projectId"] == project["id"] && a["name"] == name)
        {
            return Err(invalid("项目已有同名Agent"));
        }
        let paths = project["paths"]
            .as_array()
            .ok_or_else(|| invalid("项目没有工作目录"))?;
        let cwd = body["workspace"]
            .as_str()
            .or_else(|| paths.first().and_then(Value::as_str))
            .ok_or_else(|| invalid("请先为项目引入工作目录"))?;
        if !paths.iter().any(|p| p == cwd) {
            return Err(invalid("工作目录不属于当前项目"));
        }
        let session_id = if let Some(sid) = body["sessionId"].as_str() {
            if steward
                || self.session_workspace(sid)? != cwd
                || self
                    .catalog("space-agent")
                    .iter()
                    .any(|a| a["sessionId"] == sid)
                || self.catalog("space-thread").iter().any(|a| {
                    a["id"] == sid
                        || a["bindings"]
                            .as_object()
                            .is_some_and(|m| m.values().any(|v| v == sid))
                })
            {
                return Err(invalid("此会话已绑定，或不属于所选目录"));
            }
            sid.to_owned()
        } else {
            let model = body
                .get("model")
                .filter(|v| !v.is_null())
                .cloned()
                .map(serde_json::from_value)
                .transpose()
                .map_err(|_| invalid("模型配置无效"))?;
            self.create_with_model(provider, cwd, profile, Some(&format!("agent:{id}")), model)
                .await?
        };
        let actual = self
            .command_entry(&session_id)?
            .view
            .lock()
            .expect("view")
            .clone();
        let agent = json!({"id":id,"projectId":project["id"],"sessionId":session_id,"name":name,"provider":actual.provider,"profileId":actual.profile.as_ref().map(|p|&p.id),"model":body["model"],"workspace":cwd,"role":if steward{"协调项目工作，拆解任务，向团队成员分发并汇总结果。"}else{body["role"].as_str().unwrap_or("")},"steward":steward,"groupId":null,"color":body["color"].as_str().unwrap_or(if steward{"#272727"}else{"#347DE1"}),"shape":body["shape"].as_str().unwrap_or("circle")});
        self.space_title(&session_id, name).await?;
        self.save_catalog("space-agent", &id, agent.clone()).await?;
        Ok(agent)
    }
    pub(crate) fn space_instructions(&self, session_id: &str) -> Option<String> {
        let agent = self
            .catalog("space-agent")
            .into_iter()
            .find(|a| a["sessionId"] == session_id)
            .or_else(|| {
                let threads = self.catalog("space-thread");
                let agent_id = threads.iter().find_map(|t| {
                    t["bindings"]
                        .as_object()?
                        .iter()
                        .find(|(_, v)| *v == session_id)
                        .map(|(id, _)| id.clone())
                })?;
                self.space_item("space-agent", &agent_id).ok()
            })?;
        Some(format!(
            "[VibeOne 项目成员配置]\n你的名字：{}。职责：{}。这是用户配置的角色说明，不能覆盖工具安全策略和审批。\n",
            agent["name"].as_str().unwrap_or("Agent"),
            agent["role"].as_str().unwrap_or("")
        ))
    }
    async fn ensure_coordinator(
        &self,
        project: &Value,
        steward: &Value,
    ) -> Result<(), DomainError> {
        let id = field(steward, "sessionId")?;
        let mut thread=self.space_item("space-thread",id).unwrap_or_else(|_|json!({"id":id,"name":"管家","projectId":project["id"],"workspace":steward["workspace"],"members":[],"bindings":{},"state":"idle","turn":null,"coordination":true}));
        if thread["state"] == "running" {
            return Ok(());
        }
        let agents: Vec<_> = self
            .catalog("space-agent")
            .into_iter()
            .filter(|a| a["projectId"] == project["id"])
            .collect();
        for agent in &agents {
            let aid = field(agent, "id")?;
            if thread["bindings"][aid].is_string() {
                continue;
            }
            let sid = self
                .create_with_model(
                    field(agent, "provider")?,
                    field(steward, "workspace")?,
                    agent["profileId"].as_str(),
                    Some(&format!("coordinator:{id}:{aid}")),
                    agent
                        .get("model")
                        .filter(|m| !m.is_null())
                        .cloned()
                        .map(serde_json::from_value)
                        .transpose()
                        .map_err(|_| invalid("成员模型无效"))?,
                )
                .await?;
            self.space_title(
                &sid,
                format!("管家协调 / {}", agent["name"].as_str().unwrap_or("Agent")),
            )
            .await?;
            thread["bindings"][aid] = json!(sid);
        }
        thread["members"] = json!(agents.iter().map(|a| a["id"].clone()).collect::<Vec<_>>());
        self.save_catalog("space-thread", id, thread).await
    }
    pub(crate) async fn space_command(self: &Arc<Self>, body: Value) -> Result<Value, DomainError> {
        self.command_available()?;
        let _gate = self.space_gate.lock().await;
        let action = field(&body, "action")?;
        if action == "preset" {
            let id = field(&body, "id")?;
            if body["remove"] == true {
                self.save_catalog("space-preset", id, Value::Null).await?;
                return Ok(json!({"ok":true}));
            }
            let mut value = body.clone();
            value["name"] = json!(named(&body)?);
            if value["role"].as_str().unwrap_or("").len() > 8192 {
                return Err(invalid("角色说明过长"));
            }
            self.save_catalog("space-preset", id, value.clone()).await?;
            return Ok(value);
        }
        let project = self
            .project_views()
            .into_iter()
            .find(|p| p["id"] == body["projectId"])
            .ok_or_else(|| invalid("项目不存在"))?;
        let project_id = field(&project, "id")?;
        match action {
            "enter" => {
                let steward = self.make_space_agent(&project, &json!({}), true).await?;
                let threads = self.catalog("space-thread");
                let hidden: HashSet<String> = threads
                    .iter()
                    .flat_map(|t| {
                        t["bindings"]
                            .as_object()
                            .into_iter()
                            .flat_map(|m| m.values())
                            .filter_map(Value::as_str)
                            .map(str::to_owned)
                    })
                    .chain(
                        threads
                            .iter()
                            .filter_map(|t| t["id"].as_str().map(str::to_owned)),
                    )
                    .collect();
                let sessions: Vec<_> = self
                    .sessions
                    .lock()
                    .expect("sessions")
                    .values()
                    .map(|e| e.view.lock().expect("view").clone())
                    .collect();
                for session in sessions {
                    if !session.archived
                        && project["paths"]
                            .as_array()
                            .is_some_and(|paths| paths.iter().any(|p| p == &session.workspace))
                        && !hidden.contains(&session.id)
                        && !self
                            .catalog("space-agent")
                            .iter()
                            .any(|a| a["sessionId"] == session.id)
                    {
                        let mut name = session.title.chars().take(90).collect::<String>();
                        if self
                            .catalog("space-agent")
                            .iter()
                            .any(|a| a["projectId"] == project_id && a["name"] == name)
                        {
                            name = format!("{} · {}", name, &session.id[..6.min(session.id.len())]);
                        }
                        self.make_space_agent(&project,&json!({"id":format!("legacy:{}",session.id),"sessionId":session.id,"name":name,"workspace":session.workspace}),false).await?;
                    }
                }
                self.ensure_coordinator(&project, &steward).await?;
                Ok(json!({"steward":steward}))
            }
            "agent" => {
                if body["role"].as_str().unwrap_or("").len() > 8192 {
                    return Err(invalid("角色说明过长"));
                }
                let agent = self.make_space_agent(&project, &body, false).await?;
                if let Some(steward) = self
                    .catalog("space-agent")
                    .into_iter()
                    .find(|a| a["projectId"] == project_id && a["steward"] == true)
                {
                    self.ensure_coordinator(&project, &steward).await?;
                }
                Ok(agent)
            }
            "agent-update" => {
                let id = field(&body, "id")?;
                let mut value = self.space_item("space-agent", id)?;
                if value["projectId"] != project_id {
                    return Err(invalid("成员不属于当前项目"));
                }
                if value["steward"] == true {
                    return Err(invalid("项目管家身份固定，不能修改"));
                }
                if let Some(name) = body.get("name") {
                    let _ = name;
                    if self.catalog("space-agent").iter().any(|a| {
                        a["id"] != id && a["projectId"] == project_id && a["name"] == body["name"]
                    }) {
                        return Err(invalid("项目已有同名Agent"));
                    }
                    value["name"] = json!(named(&body)?);
                    self.space_title(field(&value, "sessionId")?, named(&body)?)
                        .await?;
                }
                for key in ["role", "color", "shape"] {
                    if let Some(v) = body.get(key) {
                        if !v.is_string() || v.as_str().unwrap().len() > 8192 {
                            return Err(invalid("配置内容无效"));
                        }
                        value[key] = v.clone();
                    }
                }
                if let Some(group) = body.get("groupId") {
                    self.check_display_group(project_id, group)?;
                    value["groupId"] = group.clone();
                }
                self.save_catalog("space-agent", id, value.clone()).await?;
                Ok(value)
            }
            "display" => {
                let id = field(&body, "id")?;
                if let Ok(old) = self.space_item("space-display", id) {
                    if old["projectId"] != project_id {
                        return Err(invalid("分组属于其他项目"));
                    }
                }
                let value = json!({"id":id,"projectId":project_id,"name":named(&body)?});
                self.save_catalog("space-display", id, value.clone())
                    .await?;
                Ok(value)
            }
            "thread" => {
                let key = field(&body, "id")?;
                if let Some(old) = self
                    .catalog("space-thread")
                    .into_iter()
                    .find(|t| t["creationId"] == key && t["projectId"] == project_id)
                {
                    return Ok(old);
                }
                let members = body["members"]
                    .as_array()
                    .filter(|v| v.len() >= 2 && v.len() <= 8)
                    .ok_or_else(|| invalid("请选择2到8个成员"))?;
                let mut unique = HashSet::new();
                let mut agents = vec![];
                for member in members {
                    let agent = self.space_item(
                        "space-agent",
                        member.as_str().ok_or_else(|| invalid("成员无效"))?,
                    )?;
                    if agent["projectId"] != project_id
                        || !unique.insert(agent["id"].clone().to_string())
                    {
                        return Err(invalid("成员重复或不属于当前项目"));
                    }
                    agents.push(agent);
                }
                let cwd = body["workspace"]
                    .as_str()
                    .or_else(|| project["paths"][0].as_str())
                    .ok_or_else(|| invalid("项目没有工作目录"))?;
                if !project["paths"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|p| p == cwd)
                {
                    return Err(invalid("目录不属于项目"));
                }
                let root = self
                    .create_with_model("codex", cwd, None, Some(&format!("thread:{key}")), None)
                    .await?;
                let name = named(&body)?;
                self.space_title(&root, name.clone()).await?;
                let mut bindings = serde_json::Map::new();
                for agent in &agents {
                    let aid = field(agent, "id")?;
                    let sid = self
                        .create_with_model(
                            field(agent, "provider")?,
                            cwd,
                            agent["profileId"].as_str(),
                            Some(&format!("member:{key}:{aid}")),
                            agent
                                .get("model")
                                .filter(|v| !v.is_null())
                                .cloned()
                                .map(serde_json::from_value)
                                .transpose()
                                .map_err(|_| invalid("模型无效"))?,
                        )
                        .await?;
                    self.space_title(
                        &sid,
                        format!("{} / {}", name, agent["name"].as_str().unwrap_or("Agent")),
                    )
                    .await?;
                    bindings.insert(aid.into(), json!(sid));
                }
                let value = json!({"id":root,"creationId":key,"name":name,"projectId":project_id,"members":members,"bindings":bindings,"workspace":cwd,"groupId":null,"state":"idle","activeSession":null,"turn":null});
                self.save_catalog("space-thread", &root, value.clone())
                    .await?;
                Ok(value)
            }
            "thread-update" => {
                let id = field(&body, "id")?;
                let mut value = self.space_item("space-thread", id)?;
                if value["projectId"] != project_id {
                    return Err(invalid("会话组不属于项目"));
                }
                if body.get("name").is_some() {
                    value["name"] = json!(named(&body)?);
                    self.space_title(id, named(&body)?).await?;
                }
                if let Some(group) = body.get("groupId") {
                    self.check_display_group(project_id, group)?;
                    value["groupId"] = group.clone();
                }
                self.save_catalog("space-thread", id, value.clone()).await?;
                Ok(value)
            }
            "send" => {
                let id = field(&body, "id")?;
                let mut thread = self.space_item("space-thread", id)?;
                if thread["projectId"] != project_id {
                    return Err(invalid("会话组不属于项目"));
                }
                let key = field(&body, "key")?;
                let receipt_id = format!("{id}:{key}");
                if let Ok(prior) = self.space_item("space-delivery", &receipt_id) {
                    if prior["text"] != body["text"] {
                        return Err(DomainError::new(
                            ErrorKind::IdempotencyConflict,
                            "同一发送标识不能改变内容",
                        ));
                    }
                    return Ok(thread);
                }
                let message_id = format!("space-user:{key}");
                let prior = self
                    .command_entry(id)?
                    .view
                    .lock()
                    .expect("view")
                    .messages
                    .iter()
                    .find(|m| m["id"] == message_id)
                    .cloned();
                if let Some(ref prior) = prior {
                    if prior["text"] != body["text"] {
                        return Err(DomainError::new(
                            ErrorKind::IdempotencyConflict,
                            "同一发送标识不能改变内容",
                        ));
                    }
                }
                if thread["state"] == "running" {
                    return Err(invalid("当前协作正在执行，请等待或停止"));
                }
                let text = body["text"]
                    .as_str()
                    .filter(|s| !s.trim().is_empty() && s.len() <= 12000)
                    .ok_or_else(|| invalid("消息需为1到12000字节"))?;
                if prior.is_none() {
                    self.append_space_message(id, "user", text, None, Some(&message_id))
                        .await?;
                }
                thread["state"] = json!("running");
                thread["turn"] = json!(key);
                thread["error"] = Value::Null;
                {
                    let _catalog = self.catalog_gate.lock().await;
                    self.put_catalog_with_receipt_locked(
                        "space-thread",
                        id,
                        thread.clone(),
                        Some((
                            "space-delivery",
                            &receipt_id,
                            &json!({"id":receipt_id,"text":text}),
                        )),
                    )
                    .await?;
                }
                let host = self.clone();
                let text = text.to_owned();
                let tid = id.to_owned();
                let turn = key.to_owned();
                tokio::spawn(async move {
                    let result = host.run_space_thread(&tid, &turn, &text).await;
                    if let Err(error) = result {
                        let _gate = host.space_gate.lock().await;
                        if let Ok(mut latest) = host.space_item("space-thread", &tid) {
                            if latest["turn"] == turn && latest["state"] == "running" {
                                latest["state"] = json!("error");
                                latest["error"] = json!(error.to_string());
                                let _ = host.save_catalog("space-thread", &tid, latest).await;
                            }
                        }
                    }
                });
                Ok(thread)
            }
            "stop" => {
                let id = field(&body, "id")?;
                let mut thread = self.space_item("space-thread", id)?;
                if thread["projectId"] != project_id {
                    return Err(invalid("会话组不属于项目"));
                }
                thread["state"] = json!("stopped");
                self.save_catalog("space-thread", id, thread.clone())
                    .await?;
                if let Some(sid) = thread["activeSession"].as_str() {
                    self.cancel_with_receipt(sid, None, None).await?;
                }
                Ok(thread)
            }
            _ => Err(invalid("未知空间操作")),
        }
    }
    fn check_display_group(&self, project: &str, group: &Value) -> Result<(), DomainError> {
        if !group.is_null()
            && self.space_item(
                "space-display",
                group.as_str().ok_or_else(|| invalid("分组无效"))?,
            )?["projectId"]
                != project
        {
            return Err(invalid("分组不属于项目"));
        }
        Ok(())
    }
    async fn run_space_thread(
        self: &Arc<Self>,
        id: &str,
        turn: &str,
        text: &str,
    ) -> Result<(), DomainError> {
        let thread = self.space_item("space-thread", id)?;
        let agents: Vec<_> = self
            .catalog("space-agent")
            .into_iter()
            .filter(|a| {
                thread["members"]
                    .as_array()
                    .is_some_and(|m| m.contains(&a["id"]))
            })
            .collect();
        let names = agents
            .iter()
            .map(|a| {
                format!(
                    "{} ({})",
                    a["name"].as_str().unwrap_or("Agent"),
                    a["id"].as_str().unwrap_or("")
                )
            })
            .collect::<Vec<_>>()
            .join("、");
        let steward = agents
            .iter()
            .find(|a| a["steward"] == true)
            .unwrap_or(&agents[0]);
        let targets: Vec<_> = agents
            .iter()
            .filter(|a| text.contains(&format!("@{}", a["name"].as_str().unwrap_or(""))))
            .collect();
        let targets = if targets.is_empty() {
            vec![steward]
        } else {
            targets
        };
        let mut queue: VecDeque<_> = targets
            .into_iter()
            .map(|a| (a.clone(), text.to_owned(), false))
            .collect();
        let mut seen = HashSet::new();
        for hop in 0..8 {
            let Some((agent, input, is_return)) = queue.pop_front() else {
                break;
            };
            let aid = field(&agent, "id")?;
            let sid = thread["bindings"][aid]
                .as_str()
                .ok_or_else(|| invalid("成员上下文缺失"))?;
            let prompt = format!(
                "[会话组：{}；本轮第{}步，最多8步。组员：{}]\n用户/成员来信：\n{}\n\n你可以直接回答。如果确实需要其他组员协作，在回答末尾输出一个 fenced code block，语言为 vibeone-handoff，内容为 JSON {{\"to\":\"目标成员ID\",\"message\":\"具体任务\"}}。只能转交给上述组员；不要为问候等简单任务转交。{}",
                thread["name"].as_str().unwrap_or(""),
                hop + 1,
                names,
                input,
                if is_return {
                    "这是一份成员结果，请汇总交付，不再转交。"
                } else {
                    ""
                }
            );
            let receipt = {
                let _gate = self.space_gate.lock().await;
                let mut latest = self.space_item("space-thread", id)?;
                if latest["turn"] != turn || latest["state"] != "running" {
                    return Ok(());
                }
                latest["activeSession"] = json!(sid);
                self.save_catalog("space-thread", id, latest).await?;
                self.submit(
                    sid,
                    prompt,
                    Some(format!("space:{turn}:{hop}")),
                    vec![],
                    vec![],
                )
                .await?
            };
            loop {
                if self.stopping.load(Ordering::SeqCst) {
                    return Ok(());
                }
                let current = self.space_item("space-thread", id)?;
                if current["turn"] != turn || current["state"] != "running" {
                    return Ok(());
                }
                let entry = self.command_entry(sid)?;
                let view = entry.view.lock().expect("view").clone();
                if let Some(run) = view.runs.iter().find(|r| r.id == receipt.operation_id) {
                    if ![
                        "accepted",
                        "queued",
                        "starting",
                        "running",
                        "requires_action",
                        "cancelling",
                    ]
                    .contains(&run.status.as_str())
                    {
                        if run.status != "completed" {
                            return Err(invalid("成员执行未完成，请查看执行详情后重试"));
                        }
                        let output = view
                            .messages
                            .iter()
                            .filter(|m| {
                                m["runId"] == receipt.operation_id && m["role"] == "assistant"
                            })
                            .filter_map(|m| m["text"].as_str())
                            .collect::<Vec<_>>()
                            .join("\n\n");
                        let (answer, handoff) = parse_handoff(&output);
                        self.append_space_message(id, "assistant", &answer, Some(&agent), None)
                            .await?;
                        if !is_return {
                            if let Some((target, message)) = handoff {
                                if let Some(next) = agents.iter().find(|a| a["id"] == target) {
                                    let signature = format!("{aid}:{target}:{message}");
                                    if seen.insert(signature) {
                                        queue.push_back((
                                            next.clone(),
                                            format!(
                                                "{}转交：{}",
                                                agent["name"].as_str().unwrap_or(""),
                                                message
                                            ),
                                            false,
                                        ));
                                    }
                                } else {
                                    self.append_space_message(
                                        id,
                                        "assistant",
                                        "转交目标不在当前会话组内，已停止转交。",
                                        Some(&agent),
                                        None,
                                    )
                                    .await?;
                                }
                            } else if agent["id"] != steward["id"] {
                                queue.push_back((
                                    steward.clone(),
                                    format!(
                                        "{}的结果：\n{}",
                                        agent["name"].as_str().unwrap_or(""),
                                        answer
                                    ),
                                    true,
                                ));
                            }
                        }
                        break;
                    }
                }
                tokio::time::sleep(std::time::Duration::from_millis(300)).await;
            }
        }
        if !queue.is_empty() {
            self.append_space_message(
                id,
                "assistant",
                "本轮达到8次成员执行上限，已停止自动转交。",
                None,
                None,
            )
            .await?;
        }
        let _gate = self.space_gate.lock().await;
        let mut latest = self.space_item("space-thread", id)?;
        if latest["turn"] == turn && latest["state"] == "running" {
            latest["state"] = json!("idle");
            latest["activeSession"] = Value::Null;
            self.save_catalog("space-thread", id, latest).await?;
        }
        Ok(())
    }
}
fn parse_handoff(output: &str) -> (String, Option<(String, String)>) {
    if let Some((answer, tail)) = output.split_once("```vibeone-handoff") {
        if let Some((json, _)) = tail.split_once("```") {
            if let Ok(value) = serde_json::from_str::<Value>(json.trim()) {
                if let (Some(to), Some(message)) = (value["to"].as_str(), value["message"].as_str())
                {
                    if !message.trim().is_empty() && message.len() <= 8000 {
                        return (answer.trim().to_owned(), Some((to.into(), message.into())));
                    }
                }
            }
        }
    }
    (output.into(), None)
}
