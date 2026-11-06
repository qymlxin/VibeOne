# 75 · Agent 环境与协议探测

Status: resolved
Type: task

## 范围

设置页主动探测内置Provider及已保存Profile的实际ACP初始化响应，展示桥接器名称/版本、协议兼容和能力，不创建会话或发送模型任务。内置CLI登录状态用只读状态命令检查，仅返回归一化状态，不泄漏原输出或凭据。超时/失败/未安装有明确结果，探测串行有界，动态插件入口保留现有会话验证。中文文档、流程SVG和真实Host/浏览器测试。

## Answer

已完成初始化探测、版本协商、CLI状态归一化、管理权限、超时清理和设置页入口。全量check通过，含51项Node、workspace Rust、19项Host和SQLite恢复；客户端13项、Workbench23项及Clippy通过。随后修正v2基础会话能力字段，专门Host回归和最终亮暗桌面62.7秒通过。830.64MiB桌面包与包外smoke通过，亮暗截图和SVG已查看。本机Codex/Claude真实初始化及CLI状态已核对，未发送模型任务。原生入口仍锁屏；02的CLI Profile选择入口与14的其余错误分类继续保留。
