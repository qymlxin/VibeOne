# 桌面窗口标题栏

顶部 `windowbar` 是原生窗口的拖动区域，标题、项目图标、连接状态文字都可以作为拖动起点。右侧工具按钮、侧栏按钮、菜单与其他交互控件继续处理正常点击，不触发窗口移动。

Tauri 2.12 的 `data-tauri-drag-region` 空属性只匹配直接点击。顶部存在文本及 SVG 子元素，因此使用 `data-tauri-drag-region="deep"` 明确允许子树拖动；工具按钮区域显式标为 `false`。顶部禁止文字选择，避免拖动时选中文字。

自定义标题栏仍需原生命令权限：主 Webview `main` 显式启用 `core:window:allow-start-dragging` 和 `core:window:allow-internal-toggle-maximize`。默认 `core:default` 不包含这两项；新增权限不授予远程网页 Webview。双击标题栏使用 Tauri 的原生最大化/恢复行为。

## 验证范围

使用安装版本 Tauri 的真实 `drag.js` 事件处理器做定向检查：旧标记点击标题子图标无法触发拖动，新标记能够触发；工具按钮子图标不触发拖动。检查主窗口权限范围并重新构建桌面，不跑全量回归。实际窗口移动与屏幕边缘行为可在新版桌面直接体验。
