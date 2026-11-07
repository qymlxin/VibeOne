# 135 · 工作区工具插件扩展点
Status: resolved
Type: task
Blocked by: 134

将文件、变更、终端、网页的App实现抽成内置插件，复用AppRuntime注册、卸载与Scope。设置提供本设备开关；第三方app.panel可声明工作区工具展示位置。核心保留权限、Host API、会话与审批。

## Answer

四个内置App实现已通过AppRuntime注册工作区面板，设置可按设备启停并持久化。第三方通过app.panel的workspace.tool展示元数据加入相同入口；已用隔离App包验证打开、workspaceId传递、Host停用后卸载。原核心服务与权限不变；中文方案/作者指南/SVG已同步。
