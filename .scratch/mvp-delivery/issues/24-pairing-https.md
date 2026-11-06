# 24 · 手机可信 HTTPS 配对与设备授权

Status: needs-triage
Type: task
Batch: D
Blocked by: 05, 07, 14, 15

## 目标

建立单 Host 的可信远程入口及可撤销设备身份。

## 依赖

[05](./05-second-agent-matrix.md)、[07](./07-host-lifecycle.md)、[14](./14-host-http.md)、[15](./15-event-client.md)。本任务为待评审计划，尚未开始实现。

## 验收

- 先在真实手机验证 HTTPS/WSS 和证书信任；优先局域网或已有可信网络直连，不自动开放公网端口。
- 配对码短期有效，电脑确认后颁发设备凭据；按工作区记录 viewer/operator/approver/owner 权限。
- 凭据存储、设备列表、过期和越权拒绝由 Host 实现；不能只靠前端隐藏按钮。

## 建议提交切片

1. 真实手机 TLS 路径验证。
2. 短期配对与电脑确认。
3. 设备身份和工作区角色。

每个切片完成相关验证后单独提交；新增失败或代码变动才扩大验证。未通过本任务验收时不标记完成。
