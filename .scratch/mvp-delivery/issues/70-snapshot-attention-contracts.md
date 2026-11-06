# 70 · 快照封装与待处理业务契约

Status: resolved
Type: task

## 范围

以生产类型构造完整快照封装，桌面与手机过滤共用同一结构；待处理请求的身份、运行关联、期限、审批选项及决策回执使用类型字段，ACP动态正文保留扩展。保持设备/工作区权限、脱敏、游标同步、唯一决策及旧列表兼容。Profile和插件目录动态记录的内部迁移、领域错误分类另行跟进。

## Answer

SnapshotResponse/Metadata已由实际生产路径构造，HTTP直接序列化，游标与手机过滤使用相同类型。工作区、Provider和设备公开视图生成共享Schema/TypeScript。PendingRequest、PermissionOption和DecisionRecord进入投影、唯一决定、投递回执与通知过期检查；ACP动态正文和扩展保留。

权限单元验证所有者原始视图不变、手机仅授权工作区、零授权、参数/本地信息隐藏及实际输出Schema。待处理回归覆盖错误请求不发布、只移除目标身份、选项类型、输入动态Schema及false/0决定内容往返。

额外旧日志用例先复现严格类型使已失效权限事件阻断回填，修复后保留原始事件与正文，只记录一次兼容提示，不恢复或重发旧请求。在线新事件仍严格校验。

最终全量51项Node/SDK、workspace Rust（Workbench18项）、16项Host、SQLite恢复、Clippy、54.9秒桌面、23.4秒HTTPS手机及829.27MiB重建包/仓库外资源检查通过。SVG已检查XML并渲染查看。Host SHA256 c1e4efbebbca9db9e50d2166c13ce1acd39e90f078b432ff76b6fc9dbe1bc2ee。原生CUA仍Mac locked，未动用户Host；Profile目录及领域错误模型等仍由14继续跟进，总目标未完成。
