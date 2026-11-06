# 76 · CLI 选择已保存的 Agent 配置

Status: resolved
Type: task

## 范围

命令行列出配置摘要、按Profile ID检查环境，并使用配置创建会话。复用运行中Host的授权HTTP接口，不直接写SQLite或复制Agent启动逻辑。只连接本地回环地址、禁止代理/重定向、隐藏令牌与配置启动参数；有界响应和超时，失败不自动重试。真实进程测试修订固定、失败路径及凭据隔离，补中文文档与SVG。

## Answer

已提供profiles list、profiles probe及session create命令。新增类型化配置摘要GET接口；CLI使用实际Rust请求契约调用Host。独立CLI进程验证修订固定、托管项目、中文/空格目录、无任务创建、参数失败和输出脱敏；网络测试验证回环限制、忽略代理、禁止重定向及响应上限，虚拟时钟验证25秒后关闭连接。完整check含51项Node、workspace Rust、21项Host和SQLite恢复通过；Clippy、桌面62.0秒、手机23.7秒、831.59MiB包及包外smoke通过。SVG已渲染查看，未操作用户实际Host。
