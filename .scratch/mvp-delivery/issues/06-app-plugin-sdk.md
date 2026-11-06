# 06 · App 插件 SDK 与最小动态面板

Status: needs-triage
Type: task
Batch: A
Blocked by: 01

## 目标

补齐尚未实现的客户端插件运行面，验证真实 React 组件动态注册。

## 依赖

[01](./01-acp-harness.md)。本任务为待评审计划，尚未开始实现。

## 验收

- 客户端本地创建 activate(ctx)，支持面板、命令、设置入口及资源 Scope。
- 共享宿主 React 和 SDK；JS 与 TS 编译的 ESM 均可加载，不向 RPC 传函数。
- 用最小页面验证加载、卸载、失败清理，以及旧 disposer 不删除新注册；服务和 Hook 具有明确契约。

## 建议提交切片

1. App Context、Registry 与 Scope。
2. 共享模块解析和 ESM 加载。
3. 动态面板、服务及 Hook 验证。

每个切片完成相关验证后单独提交；新增失败或代码变动才扩大验证。未通过本任务验收时不标记完成。
