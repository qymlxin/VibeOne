# 113 · 真实终端与桌面网页视图

Status: resolved
Type: task
Blocked by: none

## 要求

终端标签启动当前工作目录的交互Shell，支持输入/输出与尺寸变化。Agent执行输出归入执行记录。桌面网页使用独立原生Webview，支持地址、前进后退、刷新、标签隐藏/关闭，避免iframe嵌入限制。浏览器网页不获得桌面IPC权限。快速构建与必要局部验证，不跑完整回归。

## Answer

已接入portable-pty、xterm.js与Tauri字节Channel，当前目录登录Shell可交互，标签关闭释放进程；Agent命令与ACP终端事件归入执行记录并解码输出。网页改用独立子Webview，导航/布局/隐藏/关闭接通，限制外部网址与桌面IPC调用者，权限能力仅授予main。Web/Rust构建、PTY真实输入/尺寸检查通过；实际桌面执行printf/pwd返回当前目录，HTTPS百度页面已显示。3个真实Agent会话消息/执行历史保持一致。功能文档与流程SVG已更新；手机维持受限预览，本轮不全量回归。
