# 14 · Host HTTP 命令与查询 API

Status: needs-triage
Type: task
Batch: B
Blocked by: 07, 09, 10, 11, 12, 13

## 目标

暴露桌面与手机共用的命令、查询和异步操作状态接口。

## 依赖

[07](./07-host-lifecycle.md)、[09](./09-workspaces.md)、[10](./10-sessions.md)、[11](./11-run-actor.md)、[12](./12-events-outbox.md)、[13](./13-attention-state.md)。本任务为待评审计划，尚未开始实现。

## 验收

- 工作区、Profile、会话、Run、队列和待处理有类型化 DTO 与错误码。
- 命令幂等键重复得到同一结果，键相同但内容不同拒绝；长操作返回 202 和 operationId。
- 查询返回当前状态，操作可按 ID 对账；设备权限校验位于 Host。

## 建议提交切片

1. 查询接口与契约生成。
2. 命令、幂等键和回执。
3. 异步操作状态与错误映射。

每个切片完成相关验证后单独提交；新增失败或代码变动才扩大验证。未通过本任务验收时不标记完成。
