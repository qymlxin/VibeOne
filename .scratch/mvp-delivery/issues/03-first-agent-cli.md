# 03 · 第一个真实 Agent 的 CLI 对话

Status: resolved
Type: task
Batch: A
Blocked by: 02

## 目标

选择可验证的首个真实工具，让输入在实际工作区产生真实 Agent 响应。

## 依赖

[02](./02-provider-discovery.md)。实现与验收状态见本文件末尾。

## 验收

- 候选优先为 Claude Code 与 Codex，具体适配路径以实现时官方资料和实测确定。
- 完成创建上游会话、发送输入、流式输出、工具状态和最终结果。
- 认证缺失时给出操作指引；取消后停止当前轮次，异常退出有原因且无遗留进程。

## 建议提交切片

1. 真实工具启动与会话。
2. 真实 prompt 与流式输出。
3. 取消和错误展示。

每个切片完成相关验证后单独提交；新增失败或代码变动才扩大验证。未通过本任务验收时不标记完成。

## 实现进度

2026-11-06：真实Codex ACP v2对话、思考摘要及end_turn烟测通过。58/59进一步验证CLI人工审批、真实工具写入/拒绝、运行中进程取消和只读配置恢复；60补上请求超时回归。README已提供本机CLI help核对的登录操作指引。整体原型的原生/Claude/物理设备验收仍单独保留。

完整运行入口、自动验证和人工待验见 [验收清单](../../../docs/acceptance.md)。

## Answer

2026-11-07最终审计按本票原始验收核对后关闭。首个真实工具选用Codex，实际适配器为锁定的codex-acp，ACP v2创建上游会话、发送、流式回复与end_turn由显式真实模型冒烟验证。本轮再次运行node scripts/smoke-real-agents.mjs codex，结果protocolVersion=2、outcome=passed、stopReason=end_turn、error=null，使用独立Host和临时工作区，不操作用户正在运行的会话。

已重新读取本机真实结果报告：vibeone-real-controls-smoke.json的批准一次、拒绝、取消待审批、运行工具进程退出和恢复只读配置均passed；vibeone-real-input-smoke.json的结构化输入、非法回答拒绝与旧请求失效passed。58/59记录并修复真实取消后遗留工具进程的问题；60和v2/Host确定性故障用例覆盖异常退出、超时及错误展示。75/76提供实际入口/版本/认证探测与CLI登录操作指引，缺失认证不会冒充可调用。

本票为第一个真实工具的CLI接入，不要求Claude、Tauri窗口或物理手机也通过。第二工具05、原生17、手机24–26和整体52继续保持其自身未完成验收，不把本票关闭扩展为整体完成。
