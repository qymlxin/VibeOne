# 116 · 接入 Pierre 差异与文件树

Status: resolved
Type: task
Blocked by: none

## 要求

使用@pierre/diffs替换自制差异渲染，使用@pierre/trees替换自制工作区/变更文件树。绑定真实Host数据，保留文件选择、目录展开、过滤、亮暗主题及侧边预览。更新中文功能文档，快速构建与针对性检查后交付桌面。

## Answer

已固定接入 `@pierre/diffs 1.6.4` 与 `@pierre/trees 1.0.0-beta.6`，替换差异、只读文件与目录树渲染。保留真实 Host 数据，文件夹按需加载、Git 状态/增删装饰、过滤和主题同步。移除旧 CodeText / highlight.js 实现。

验证：组件定向检查通过（选择、子目录加载、过滤、亮暗切换）；实际工作目录 4 文件 Git 补丁解析通过；Web 与桌面打包通过；原生应用已显示真实会话的 4 文件差异和目录树。未跑全量桌面/手机回归，未启动新 Agent 任务。

设计与数据流见 [Pierre 渲染](../../../docs/pierre-rendering.md)。
