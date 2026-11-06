# 18 · 工作区与 Agent 设置页面

Status: needs-triage
Type: task
Batch: C
Blocked by: 02, 09, 10, 14, 17

## 目标

替换工作区和 Agent 选择的模拟数据，支持真实用户配置。

## 依赖

[02](./02-provider-discovery.md)、[09](./09-workspaces.md)、[10](./10-sessions.md)、[14](./14-host-http.md)、[17](./17-tauri-shell.md)。本任务为待评审计划，尚未开始实现。

## 验收

- 通过目录选择导入工作区，查看真实列表与目录不可用状态。
- 显示工具探测结果、Profile 和能力缺失，能进入认证指引。
- 选择工作区和 Profile 后创建真实空会话；维持紧凑布局、系统字体及亮暗模式。

## 建议提交切片

1. 工作区列表与导入。
2. Agent 探测和 Profile 设置。
3. 真实会话创建入口。

每个切片完成相关验证后单独提交；新增失败或代码变动才扩大验证。未通过本任务验收时不标记完成。
