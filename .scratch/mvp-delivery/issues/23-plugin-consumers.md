# 23 · Provider 与通知扩展接入主流程

Status: needs-triage
Type: task
Batch: C
Blocked by: 02, 10, 12, 19, 22

## 目标

让真实业务消费插件贡献，避免插件机制只停留在独立演示。

## 依赖

[02](./02-provider-discovery.md)、[10](./10-sessions.md)、[12](./12-events-outbox.md)、[19](./19-chat-ui.md)、[22](./22-local-plugin-product.md)。本任务为待评审计划，尚未开始实现。

## 验收

- 新增一个声明式 ACP Provider 无需修改 Host 核心；LaunchSpec 经过 Host 再校验。
- 会话实际持有 Provider 代次租约；更新不切断旧会话，禁用不影响已有租约的排空规则。
- 示例插件贡献真实面板、命令、设置与本地通知，通知来自事务 outbox，故障不阻塞审批。

## 建议提交切片

1. Provider 扩展目录与会话租约。
2. 插件面板、命令和设置联调。
3. 通知扩展与 outbox 消费。

每个切片完成相关验证后单独提交；新增失败或代码变动才扩大验证。未通过本任务验收时不标记完成。
