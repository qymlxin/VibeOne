# 27 · 核心 MVP 验收与 macOS 打包

Status: needs-triage
Type: task
Batch: E
Blocked by: 05, 16, 17, 21, 23, 26

## 目标

交付可以独立启动的核心首版，完成真实工具、真实手机和重启恢复验收。

## 依赖

[05](./05-second-agent-matrix.md)、[16](./16-workspace-changes.md)、[17](./17-tauri-shell.md)、[21](./21-history-diagnostics-ui.md)、[23](./23-plugin-consumers.md)、[26](./26-phone-recovery-revoke.md)。本任务为待评审计划，尚未开始实现。

## 验收

- macOS 安装产物能发现 Host 和 Node runner，不依赖开发机源码路径；Node 缺失或版本不兼容有修复指引。
- 两真实工具共享核心 UI；真实手机审批、取消、断线重连、历史恢复与旧 Provider 租约更新全部验收。
- Host 的 Linux/Windows CI 和平台差异明确；未经实机验证不声称桌面全平台可用。记录版本、日志和剩余限制。

## 建议提交切片

1. 打包与运行时发现。
2. 跨平台 Host 检查和故障演练。
3. 两工具及真实手机的首版验收记录。

每个切片完成相关验证后单独提交；新增失败或代码变动才扩大验证。未通过本任务验收时不标记完成。
