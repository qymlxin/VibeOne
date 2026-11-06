# MVP 交付地图

## Notes

2026-11-06：以主要功能版为当前交付；保持本地 Markdown 跟踪，逐功能提交。验证入口与人工待验集中于 [验收清单](../../docs/acceptance.md)。

## Decisions-so-far

- [38 设置中心设计稿](issues/38-settings-design-review.md)：基于现有能力制作八分类设置，整合外观，Agent/插件用列表详情；搜索、配置、信任、设备授权等演示交互已检查。原型分支保持独立，正式重构待审阅。

- [37 三栏工作台设计稿](issues/37-three-pane-design-review.md)：独立原型分支 `prototype/three-pane-review` 提供会话/对话/右侧工具面板与亮暗预览。仅完成设计稿，正式重构等待用户审阅批准。

- [36 对话导航与语义执行摘要](issues/36-chat-navigation-semantic-events.md)：侧边短线定位当前已加载轮次，提供摘录预览与键盘跳转；读取工具按真实 ACP 类型展示文件名/完整路径，命令保留 Shell 详情。模型、桌面、手机与原生导航验证通过。

- [35 嵌套过程与思考扫光](issues/35-nested-process-shimmer.md)：整轮过程、连续同类工具组与单次详情逐级展开，最终答案独立；实时状态/摘要轻微扫光，完成、离屏、隐藏和减少动画时停止。桌面、手机与原生历史验证通过。

- [34 工具详情与 Markdown](issues/34-readable-tools-markdown.md)：常见工具结构化渲染，原始数据按需查看；区分段内换行和块间空白，保留代码缩进。原生历史、桌面与手机链路均验证。

- [33 聊天事件顺序](issues/33-chat-event-order.md)：执行前说明、连续工具活动与最终回复按首次事件顺序混排；已在原生新闻会话核对，无需重启工作主机。

- [32 实时聊天活动区](issues/32-live-chat-activity.md)：每轮默认折叠，滚动预览最近三项真实活动；详情按需展开，用户阅读时暂停跟随。桌面、手机、主题、重启和原生演示验证通过。

- [31 统一存储与免选目录项目](issues/31-managed-projects.md)：托管项目、历史新上下文续聊、空闲迁移与只读主目录回退已实现并验证；不冒充原生 Agent 上下文恢复。

- [30 旧会话升级启动失败](issues/30-legacy-startup.md)：兼容缺失/null 执行列表，保留会话历史；回归覆盖连续重启与旧导出导入。

- [06-app-plugin-sdk](issues/06-app-plugin-sdk.md)：AppRuntime 提供候选激活、面板/命令/设置、Scope 与服务/Hook；共享宿主 React、React DOM、SDK，支持 JS 与 TS/TSX 编译的 ESM。SDK 生命周期测试及真实 Host 的浏览器动态面板测试通过。
- [09-workspaces](issues/09-workspaces.md)：工作区按规范路径去重，文件 API 使用能力目录与路径校验；Git Worktree 执行租约与分发前文件引用复验已接入。工作区集成测试覆盖越界、符号链接、Git 差异和引用。跨平台文件系统差异仍按发布清单实机验收。
- [10-sessions](issues/10-sessions.md)：会话由 Host 持久化，支持延迟启动、标题搜索/重命名/归档；Profile 修订、插件 Provider 代次及上游身份分别保存。活动执行禁止归档，历史恢复不自动启动。Host、恢复与桌面测试通过。
- [11-run-actor](issues/11-run-actor.md)：串行 Run、20 条队列、幂等提交、撤回、工作区互斥、失败/取消暂停与显式恢复已实现。集成测试还验证不响应取消/关闭的假 Agent 及其真实子进程在宽限期后被清理。
- [12-events-outbox](issues/12-events-outbox.md)：状态、单调游标事件及通知 outbox 同事务提交；投递独立异步执行、有限退避重试、稳定 eventId，恢复时淘汰旧待处理通知。SQLite、事件查询、恢复及真实插件消费测试通过。客户端当前通过 WS 通知后获取快照，增量 reducer 属于任务 15 的剩余项。
- [13-attention-state](issues/13-attention-state.md)：审批与结构化输入分别持久化，包含原始选项/Schema、有效期和 Run；唯一决定、同决定重试、冲突及投递不确定状态已实现，恢复后不重放批准。测试覆盖并发决定、Schema 拒绝及 session/new 尚未完成时的输入回应。真实工具验证仍由任务 04 跟踪。
- [16-workspace-changes](issues/16-workspace-changes.md)：实现带分支/时间的已暂存、未暂存、未跟踪差异和受范围限制的文件预览；二进制/大文件明确提示。文本产物快照关联最近 Run，源文件后续修改不影响快照；工作区集成测试通过。
- [19-chat-ui](issues/19-chat-ui.md)：聊天接入持久 Host 状态与真实 ACP 流；展示思考摘要、Markdown、工具输出、执行回执、运行/等待/结束状态，支持队列、取消、文本引用和本地草稿。桌面浏览器测试与执行/恢复测试通过；最近 128 条消息的投影上限已记录。
- [20-attention-ui](issues/20-attention-ui.md)：审批与 Input Request 接入持久决定；保留上游选项，表单 JSON Schema 校验，支持接受/拒绝/取消和独立回执状态。桌面与手机浏览器链路、冲突与恢复测试通过；真实工具复杂授权待人工验收。
- [21-history-diagnostics-ui](issues/21-history-diagnostics-ui.md)：历史搜索、重命名、归档、只读恢复、Git diff、文件与不可变产物查看、允许列表诊断导出已实现。桌面/工作区/恢复测试通过；完整长历史分页尚未提供，当前投影容量在验收文档中列明。
- [22-local-plugin-product](issues/22-local-plugin-product.md)：可信本地包检查、授权范围、配置校验、持久安装/更新/停用/重新启用与管理界面已实现；App 候选先成功再发布 Worker 路由，失败保留旧代次。每候选独立 Runner，自动重启预算明确为 0。Node/Rust/Host/桌面测试通过。
- [23-plugin-consumers](issues/23-plugin-consumers.md)：示例插件实际贡献 Provider、React 面板、命令、设置与通知渠道；会话持有 Provider 代次租约，停用后已有租约继续排空；通知来自事务 outbox，独立超时重试。自动验证业务链路通过；操作系统通知权限及外部通知渠道另行人工验证。

## Fog

- 真实 Claude 认证与真实工具审批/取消由本机账号和实际工具能力决定。
- 物理 iOS/Android 证书信任、弱网、锁屏及 macOS 托盘/系统通知仍待人工验收。
- 客户端当前用 WS 通知加快照恢复；事件增量 reducer、长历史分页及完整 DTO 生成未完成。
- 公开 SDK 完整 semver/跨插件依赖、跨平台发行、签名公证后置。
