# 117 · 窗口拖动恢复与浏览器实现调查

Status: resolved
Type: task
Blocked by: none

补齐原生标题栏拖动；仅检查本机 Cursor 程序资源解释 Browser Tab 内核、嵌入和会话机制，不访问个人浏览数据。快速检查和打包，更新中文文档。

## Answer

标题栏根因：`core:default` 不包含 `start_dragging` 权限；空的拖动标记不覆盖标题内部子元素。主 `main` Webview补齐原生拖动/双击最大化权限，标题区改为deep，工具操作区显式false。安装版本真实drag.js定向检查证明旧标题子图标不触发、新实现触发，工具按钮不触发。桌面已重新打包并打开；实际窗口移动由用户继续体验，未跑全量回归。

只读调查本机Cursor打包资源，确认WebContentsView/Chromium、持久浏览分区、IPC动作与事件链路；与本项目macOS WKWebView不同。调查不证明百度验证码的具体触发原因，未迁移浏览内核。中文报告与SVG见 docs/cursor-browser-investigation.md，标题栏说明见 docs/window-chrome.md。
