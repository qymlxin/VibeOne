# 103 · 会话配置与控制回执共享契约

Status: resolved
Type: task
Blocked by: none

## 直接证据

server.rs中configure_agent仍接收Json<Value>并手工提取id；配置/元数据、人工决定和原上下文选择的成功响应仍由临时JSON拼接，未进入Schema/TypeScript生成。正式AgentConfigControls直接拼路径和请求。

## 验收

- 会话配置使用实际Rust请求结构并生成共享类型；value保留Agent动态JSON，不伪造静态配置全集。
- 配置/元数据、审批/回答和上下文选择成功回执由真实结构生成，保持原HTTP字段及原有业务校验。
- 正式配置入口使用构造器；真实Host验证有效配置、非法参数不改变状态和回执字段，补充类型反例。
- 更新中文文档、运行相关回归并单独提交；不把本项当作全部API或原生验收完成。

## Answer

ConfigureAgentRequest由实际HTTP解析器使用；配置/元数据、审批/回答、原上下文选择分别使用SessionUpdateResponse、DecisionSubmittedResponse、ResumeContextResponse。字段与原成功行为保持，配置id缺失/类型错误使用统一422 VALIDATION_FAILED；value省略保留null，由当前Agent能力校验。回答正文继续是上游Schema约束的动态JSON，不改变表单协议。

输入区与完整配置控件共用configureAgent构造器；共享类型包含实际参数和响应结构。新增Schema使旧大JSON宏触发编译递归上限，改为独立Schema条目组成导出对象；原有生成字段保持，仅新增本组类型。

验证：60项Node/SDK（包含漂移和TypeScript正反例）、workspace Rust（Workbench54项、存储9项）、严格Clippy和格式通过；8项相关Host测试通过，随后增加原上下文/回答成功字段断言的7项测试亦通过。真实构造器应用配置、拒绝非法值和身份后实际配置不变，审批/回答重复与冲突、断开HTTP后配置保存及原上下文恢复继续通过。桌面70.7秒、HTTPS手机23.8秒通过，已查看正式配置控件截图；835.01MiB包与包外冒烟通过，Host SHA256为`6cc9e2de57e5d25ee660af535741876009381ca7cf1c5991d2d4b66a743a1465`。

中文说明更新于docs/client-contracts.md，调用链无变化，沿用其已有SVG。原生CUA本轮仍明确Mac locked；实际用户Host PID39028只读HTTP200，5会话idle、无队列/存储故障，未停止或重启。14完整API验收和52实机验收保持未完成，不将本项的结构补齐当作整个目标已完成。
