# 105 · Host跨平台持续集成

Status: claimed
Type: task
Blocked by: none

## 直接证据

27明确要求Host的Linux/Windows CI及平台差异，但当前仓库没有.github/workflows目录。批准原型控件复核未发现新占位入口；原生Mac锁屏、Claude未登录与物理手机验收仍需保留，不能用它们掩盖可实现的CI缺口。

## 验收

- GitHub Actions在Linux、Windows和macOS执行Host构建、Rust测试、共享契约/Node检查及隔离Host冒烟，不依赖本机凭据。
- 工作流固定工具链及第三方Action提交，最小只读权限，矩阵失败不取消其他平台，不发布未验收桌面安装包。
- 真实查看远程运行结果并处理失败；平台限制与未覆盖实机项目明确记录。
- 中文说明和验收证据更新，分阶段提交，不把CI通过冒充原生桌面或物理手机验收。
