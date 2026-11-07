# 工作区工具插件

本版将文件浏览、变更审阅、交互终端与网页预览的界面实现抽成四个内置 App 插件。工作台只负责工具入口、标签页、尺寸和异常兜底，通过注册表取得实际面板组件。插件使用 JavaScript/JSX 编写，构建后作为 JavaScript 模块运行；第三方作者也可以用 TypeScript 编写并编译为 JavaScript。

## 已实现的边界

| 功能 | 归属 | 扩展方式 |
| --- | --- | --- |
| 文件树、文件预览 | 内置文件浏览插件 | 注册 `files` 面板 |
| Git变更树、差异审阅 | 内置变更审阅插件 | 注册 `changes` 面板 |
| 终端界面 | 内置交互终端插件 | 注册 `terminal` 面板；Electron提供PTY |
| 网页界面、历史导航 | 内置网页预览插件 | 注册 `browser` 面板；Electron提供隔离网页视图 |
| 第三方工作区工具 | 已安装App插件 | `app.panel` + `surface: workspace.tool` |
| 面板布局、标签页与异常隔离 | 工作台核心 | 消费注册表，不直接选择功能实现 |
| 文件访问授权、Git读取、插件生命周期、Agent执行 | Rust Host / Electron核心服务 | 已有API与IPC，界面开关不改变服务权限 |

内置插件通过现有 `defineApp` / `AppRuntime` 注册面板，不是单纯给固定界面加一个隐藏标记。启用时加载模块、准备并发布候选；停用时撤下注册并卸载对应React组件。终端组件清理时结束其Shell，网页组件清理时关闭独立网页视图；Host中正在执行的Agent任务不受影响。内置文件/变更共用文件能力实现，分别注册与启停。

## 设置中的开关

设置 → 插件新增「内置工作区插件」区域，文件、变更、终端、网页分别提供开关。该偏好保存在当前设备的 `vibeone-disabled-ui-plugins`；不会同步关闭其他设备的界面，也不撤销Host权限。未启用的工具从新标签页入口撤下；已有标签页显示未启用状态，不继续渲染功能组件。重新启用后可继续打开工具。

下面的本地插件包管理仍由Host管理，保留安装、候选准备、提交、失败回退、停用与授权范围。重新启用第三方包沿用已有重新检查流程，不能用本设备开关绕过包信任与权限确认。已打开的第三方面板随Host停用而撤下。

## 第三方接入

清单使用已有的 `app.panel` 扩展点，并增加展示元数据，不新增一套RPC协议：

```json
{
  "id": "workspace-panel",
  "kind": "app.panel",
  "kindVersion": 1,
  "binding": { "type": "app" },
  "surface": "workspace.tool",
  "title": "工作区扫描",
  "description": "检查已授权工作区",
  "icon": "folder"
}
```

App入口仍使用现有SDK：

```js
export default defineApp(ctx => {
  ctx.panels.register('workspace-panel', WorkspacePanel);
});
```

注册ID必须预先声明。组件接收 `sessionId`、`workspaceId`；业务数据通过已授权的SDK服务与Worker调用获取。第三方组件不会因为进入工作区而取得内置工具使用的完整工作台对象。工具内部ID按插件ID和贡献ID命名空间隔离，不允许覆盖核心工具。图标使用宿主支持的 `folder`、`changes`、`terminal`、`browser`；未知图标回退到通用图标。

示例包 `examples/plugins/workspace-tools` 已声明该展示位置，安装或更新后可在工作区工具列表找到「工作区扫描」。Host仍负责其Worker授权，原有插件设置展示保留。

![工作区工具扩展边界](diagrams/workspace-tool-extensions.svg)

## 后续可抽取的功能

- 输入区：斜杠命令、上下文来源和工具栏动作。
- 消息展示：工具结果卡片、代码块和消息操作。
- 外观与设置：主题、独立设置页和工作区侧栏。
- 协作视图：会话组展示、首页看板和项目空间布局。

这些是候选方向，当前尚未形成可由第三方注册的公开契约。Agent Provider、设置区、App命令、Hook和Worker通知沿用已经实现的插件能力。会话持久化、审批授权、执行队列、协作调度和远程鉴权保持核心职责，避免停用界面插件破坏历史或进行中的任务。

## 验证范围

针对性检查已覆盖目录展开读取正文、文件插件停用/持久化/重启用、第三方工具进入工作区并随Host停用卸载，以及Web构建。未执行全量桌面或手机回归；未调用模型、未修改真实项目文件。
