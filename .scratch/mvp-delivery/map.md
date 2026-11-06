# MVP 交付地图

## Notes

2026-11-06：以主要功能版为当前交付；保持本地 Markdown 跟踪，逐功能提交。验证入口与人工待验集中于 [验收清单](../../docs/acceptance.md)。

## Decisions-so-far

- [43 正式版交付](issues/43-workbench-phase.md)：29 项模型/原生/浏览器测试通过，Clippy、macOS 打包和原生历史核对完成；只重开桌面，Host 保持运行。

- [42 界面偏好](issues/42-workbench-phase.md)：本设备持久外观和头像、距离衰减索引、新原生图标已接入，存储与减少动画回退明确。

- [41 统一设置](issues/41-workbench-phase.md)：八分类设置接回真实业务，Agent 和插件采用列表详情；保留本机/远程管理权限边界。

- [40 侧边工具与预览](issues/40-workbench-phase.md)：真实文件/差异/产物、只读终端、工作区文件链接与隔离网页预览接入，可调整面板宽度。

- [39 三栏工作台](issues/39-workbench-phase.md)：正式三栏容器、新品牌与消息分段已接入，保留原 Host 与审批链路；完整回归由交付阶段统一核对。

- [38 设置中心设计稿](issues/38-settings-design-review.md)：基于现有能力制作八分类设置，整合外观，Agent/插件用列表详情；搜索、配置、信任、设备授权等演示交互已检查。原型分支保持独立，已获用户批准，正式落地见 39–43。

- [37 三栏工作台设计稿](issues/37-three-pane-design-review.md)：独立原型分支 `prototype/three-pane-review` 提供会话/对话/右侧工具面板与亮暗预览。仅完成设计稿，已获用户批准，正式落地见 39–43。

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

- [44-composer-menus](issues/44-composer-menus.md)：正式输入框接入 ACP 指令与工作台快捷入口、`@` 目录浏览和多文件引用标签；复用 Host 校验和队列，补充键盘、输入法与手机适配以及中文文档、SVG。

- [45-prototype-file-explorer](issues/45-prototype-file-explorer.md)：补齐真实目录树/筛选/行号、Git差异着色统计与暂存切换，Host端到端验证通过；完整原型缺口列入 docs/prototype-completion.md。

- [46-prototype-navigation-actions](issues/46-prototype-navigation-actions.md)：补齐回答复制、执行记录定位、网页历史、面板扩大和当前工作区变更卡片，真实Host/iframe回归通过。

- [47-composer-agent-config](issues/47-composer-agent-config.md)：输入区/侧栏共享ACP原生配置控件与失败回退，补齐Profile恢复默认入口和常规跳转，桌面与HTTPS手机回归通过。

- [48-manual-queue-pause](issues/48-manual-queue-pause.md)：补齐显式暂停/恢复队列、Host能力标记及冲突校验，4项执行集成与桌面回归通过；SVG链路已更新。

- [49-project-session-sidebar](issues/49-project-session-sidebar.md)：补齐项目分组/折叠、真实最近排序、搜索快捷键与侧栏开合，新增活动时间持久化；单元、桌面、崩溃恢复与Clippy通过。

- 完整原型交付：50 附件、51 长历史已实现；52逐项审计和实际原生核对继续，Mac锁屏时不绕过限制，解锁后只在空闲时升级Host。目标保持active。

- [50-prototype-attachments](issues/50-prototype-attachments.md)：补齐真实附件存储/上传/预览/下载、图片粘贴拖放及ACP内容块，验证字节哈希、作用域、幂等与恢复；桌面/HTTPS手机回归通过。

- [53-composer-completion](issues/53-composer-completion.md)：补齐直接发送本地指令、未知指令透传与引用目录刷新，真实 Host 桌面和 HTTPS 手机回归通过。

- [51-complete-conversation-history](issues/51-complete-conversation-history.md)：补齐事务历史档案/分页、可中断回填、旧消息及工具增量、前端重连补齐/阅读锚点与长导航；Host、恢复、桌面和HTTPS手机通过。

- [54-notification-permission-state](issues/54-notification-permission-state.md)：补齐本设备通知开关与真实权限查询、macOS系统回调及冷启动事件基线；桌面/手机与原生编译检查通过，系统弹窗仍归52实机验收。

- [55-workspace-path-import](issues/55-workspace-path-import.md)：补齐设置原型的绝对路径输入与导入，目录选择改为填入后明确提交；真实Host验证相对拒绝、空格目录、幂等与成功反馈。

- [56-packaged-acp-bridges](issues/56-packaged-acp-bridges.md)：移除桌面包对开发仓库桥接器的隐式依赖，随包复制锁定适配器/生产闭包/本平台CLI；仓库外两个v2握手、CLI、网页、Worker、插件Provider与历史验证通过。

- [52-prototype-final-audit](issues/52-prototype-final-audit.md)：逐控件矩阵已保存，当前自动检查和包外资源验证通过；Mac锁屏、Claude认证及物理设备/系统界面仍未验收，总目标未完成。

- [57-composer-caret-race](issues/57-composer-caret-race.md)：修复引用入口和候选选择延迟恢复光标覆盖新输入的问题；延迟动画帧用例修复前红、修复后绿，桌面及HTTPS手机回归通过。

- 58真实Codex审批/结构化输入与59取消进程排空已补齐，见[58](issues/58-real-agent-controls.md)、[59](issues/59-cancel-process-drain.md)。真实工具的批准、拒绝、取消待审批、进程退出及新上下文只读恢复均通过。

## Fog

- 真实Claude认证及该工具的审批/取消仍由本机账号和实际工具能力决定；Codex路径已有实测。人工请求自然超时尚需可控时间回归。
- 物理 iOS/Android 证书信任、弱网、锁屏及 macOS 托盘/系统通知仍待人工验收。
- 客户端当前用 WS 通知加快照恢复；事件增量 reducer及完整 DTO 生成未完成；长历史已独立分页交付。
- 公开 SDK 完整 semver/跨插件依赖、跨平台发行、签名公证后置。
