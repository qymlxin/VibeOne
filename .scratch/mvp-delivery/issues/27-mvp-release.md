# 27 · 核心 MVP 验收与 macOS 打包

Status: claimed
Type: task
Batch: E
Blocked by: 05, 16, 17, 21, 23, 26

## 目标

交付可以独立启动的核心首版，完成真实工具、真实手机和重启恢复验收。

## 依赖

[05](./05-second-agent-matrix.md)、[16](./16-workspace-changes.md)、[17](./17-tauri-shell.md)、[21](./21-history-diagnostics-ui.md)、[23](./23-plugin-consumers.md)、[26](./26-phone-recovery-revoke.md)。实现与验收状态见本文件末尾。

## 验收

- macOS 安装产物能发现 Host 和 Node runner，不依赖开发机源码路径；Node 缺失或版本不兼容有修复指引。
- 两真实工具共享核心 UI；真实手机审批、取消、断线重连、历史恢复与旧 Provider 租约更新全部验收。
- Host 的 Linux/Windows CI 和平台差异明确；未经实机验证不声称桌面全平台可用。记录版本、日志和剩余限制。

## 建议提交切片

1. 打包与运行时发现。
2. 跨平台 Host 检查和故障演练。
3. 两工具及真实手机的首版验收记录。

每个切片完成相关验证后单独提交；新增失败或代码变动才扩大验证。未通过本任务验收时不标记完成。

## 实现进度

2026-11-06：主要功能版与 macOS 调试包已生成，包内携带 Host、Web、Node Runner/SDK 和示例插件；本机仍需 Node 22+ 与实际工具认证。最终 42 项自动化回归、Clippy 与桌面打包通过，并在项目目录之外验证包内 Host/Runner/示例 Provider；自动化覆盖执行、审批、恢复、插件和 HTTPS 手机链路；真实 Claude 认证、真机、系统通知/托盘、跨平台与签名公证保留人工清单，不宣称正式发行验收通过。

完整运行入口、自动验证和人工待验见 [验收清单](../../../docs/acceptance.md)。


105补齐Host三平台CI，真实运行42322487387在Ubuntu 24.04、Windows 2022、macOS 15全部通过。Windows换行、插件打包范围与Node规范路径问题已分别提交修复；独立Host鉴权/ACP/审批/重启检查通过。Host CI要求完成，不替代桌面全平台发行或物理手机验收。
