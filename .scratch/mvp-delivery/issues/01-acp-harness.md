# 01 · ACP 客户端与可控假 Agent

Status: resolved
Type: task
Batch: A
Blocked by: none

## 目标

建立独立于 Plugin RPC 的 ACP 接入模块，以 CLI 验证初始化、会话、消息流和双向请求。

## 依赖

无（现有插件基础已具备）。用户已批准开工；本轮以 ACP v2 Draft 为协议目标，SDK 版本与协议版本分别锁定。

## 验收

- 用可控假 Agent 覆盖 initialize、session/new、prompt、update、cancel、异常帧和退出。
- prompt 未完成时仍能处理权限与文件请求，不阻塞读取；协议不兼容明确失败。
- 固定本轮 SDK 与协议版本，接入自动化检查；测试不依赖模型账号。

## 建议提交切片

1. ACP 握手与会话建立。
2. 流式消息与双向请求。
3. 取消及异常进程清理。

每个切片完成相关验证后单独提交；新增失败或代码变动才扩大验证。未通过本任务验收时不标记完成。

## Answer

已交付官方 Rust SDK 5.0.0 的严格 ACP v2 客户端。4 项协议集成测试覆盖流、早到状态、chunk/快照、审批、取消、畸形帧、崩溃与 v1 拒绝；工作台投影另有 2 项语义测试。无 GUI 路径通过 headless Host 与 CLI 测试脚本验证。
