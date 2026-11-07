# MVP 交付地图

## Notes

2026-11-06：以主要功能版为当前交付；保持本地 Markdown 跟踪，逐功能提交。验证入口与人工待验集中于 [验收清单](../../docs/acceptance.md)。

## Decisions-so-far

- [110 项目与默认续接](issues/110-project-workspaces-default-resume.md)：一个项目多个目录和会话，项目分组及持久管理接通，历史默认恢复原上下文，按快速迭代构建后体验。

- [108 对话过程与读取](issues/108-chat-process-prototype-parity.md)：完成整轮/工具组两层折叠、读取文件链接与变更整行入口；真实Codex及本机包确认。

- [109 右侧原型源码](issues/109-direct-prototype-file-panel.md)：按用户最新要求直接迁入右侧JSX和CSS，Git目录聚合修正，快速构建后交用户体验。

- [107 桌面视觉一致](issues/107-desktop-prototype-parity.md)：已直接迁入批准原型核心CSS/DOM/外观组件，删除旧桌面布局；桌面、手机、已有配置/插件/长标题/人工等待视觉、打包冒烟及实际Tauri亮暗验收通过，六会话历史与元数据不变。

- [106 原生输入菜单](issues/106-native-composer-focus.md)：修复focus/选区竞争，桌面与手机回归及真实Tauri的 `/`、`@` 菜单/文件选择通过；临时会话已归档，原视图恢复。

- [03 首个真实Agent](issues/03-first-agent-cli.md)：按原始验收复核并关闭；本轮真实Codex对话再次end_turn，既有真实批准/拒绝、取消进程/只读恢复和结构化输入结果报告重新核对通过。Claude/原生/真机继续各自验收。

- [105 Host跨平台CI](issues/105-host-platform-ci.md)：三平台真实运行42322487387全部通过；修复Windows检出换行、打包路径和Node Runner规范路径三处差异。Host CI关闭，原生/物理设备仍独立验收。

- [104 会话修改对账](issues/104-session-metadata-receipts.md)：修复旧重命名/归档请求重试覆盖新状态；共享请求、原子持久回执和正式页面手动重试接入，存储故障及各端验证见票据。

- [103 会话控制共享契约](issues/103-session-control-contracts.md)：配置实际请求及配置/元数据、决定和上下文选择成功回执接生成链路；正式配置入口统一构造器，动态Agent值与回答语义保持。验证与边界见票据。

- [102 产物保存对账](issues/102-artifact-capture-receipts.md)：保存请求使用持久幂等回执，事务内提交产物/事件/回执；重试返回原内容和关联，跳过未开始/撤回队列项。正式页面保留失败身份并显式重试，完整验证见票据。

- [101 队列控制对账](issues/101-queue-command-receipts.md)：暂停/继续/撤回接持久幂等、原子投影与重启保护；队列清空后的失败重试保留，中文提示及手机44px目标实测通过。完整回归与打包通过，接续102产物保存。

- [100 停止请求对账](issues/100-stop-command-receipts.md)：修复旧停止请求影响后续Run，增加持久受理、原子投影与目标保护，桌面/手机接入；并发、重启、SQLite故障、权限及完整回归通过。
- 后续已直接复现：[101 队列控制](issues/101-queue-command-receipts.md)同键撤回重试报冲突；[102 产物保存](issues/102-artifact-capture-receipts.md)同键重复生成快照。保持整体目标，依次实现并验证。

- [99 Agent 配置操作回执](issues/99-profile-command-receipts.md)：新建、修订、移除接持久幂等与原子目录事务；设置页丢失响应可手动同键重试，异常移除保留重试入口，真实并发/重启/SQLite故障/HTTPS权限及桌面验证通过。

- [97 会话创建对账](issues/97-session-creation-idempotency.md)：原子持久创建回执与正式表单同键重试接入；真实并发、重启、丢失响应、存储故障和HTTPS权限通过，文档/SVG及桌面包同步更新。

- [96 Host 生命周期验收](issues/96-host-lifecycle-acceptance.md)：隔离服务端验证单实例、私有鉴权、断开保活、进程树停止和重启中断恢复；原生窗口验收继续保留，创建幂等缺口交由97修复。

- [98 指令和引用输入](issues/98-composer-chinese-triggers.md)：核对正式菜单和真实上下文发送，补全中文无空格触发；输入框单元测试与真实 Host 桌面回归通过，亮暗截图已核对。

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
- [12-events-outbox](issues/12-events-outbox.md)：状态、单调游标事件及通知 outbox 同事务提交；投递独立异步执行、有限退避重试、稳定 eventId，恢复时淘汰旧待处理通知。SQLite、事件查询、恢复及真实插件消费测试通过。客户端游标投影增量后由63补齐，见任务15和docs/cursor-sync.md。
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

- 完整原型交付：50 附件、51 长历史已实现；52逐项审计和实际原生核对继续，Mac锁屏时不绕过限制，解锁后只在空闲时升级Host。后续完整范围以当前用户指示为准。

- [50-prototype-attachments](issues/50-prototype-attachments.md)：补齐真实附件存储/上传/预览/下载、图片粘贴拖放及ACP内容块，验证字节哈希、作用域、幂等与恢复；桌面/HTTPS手机回归通过。

- [53-composer-completion](issues/53-composer-completion.md)：补齐直接发送本地指令、未知指令透传与引用目录刷新，真实 Host 桌面和 HTTPS 手机回归通过。

- [51-complete-conversation-history](issues/51-complete-conversation-history.md)：补齐事务历史档案/分页、可中断回填、旧消息及工具增量、前端重连补齐/阅读锚点与长导航；Host、恢复、桌面和HTTPS手机通过。

- [54-notification-permission-state](issues/54-notification-permission-state.md)：补齐本设备通知开关与真实权限查询、macOS系统回调及冷启动事件基线；桌面/手机与原生编译检查通过，系统弹窗仍归52实机验收。

- [55-workspace-path-import](issues/55-workspace-path-import.md)：补齐设置原型的绝对路径输入与导入，目录选择改为填入后明确提交；真实Host验证相对拒绝、空格目录、幂等与成功反馈。

- [56-packaged-acp-bridges](issues/56-packaged-acp-bridges.md)：移除桌面包对开发仓库桥接器的隐式依赖，随包复制锁定适配器/生产闭包/本平台CLI；仓库外两个v2握手、CLI、网页、Worker、插件Provider与历史验证通过。

- [52-prototype-final-audit](issues/52-prototype-final-audit.md)：逐控件矩阵已保存，当前自动检查和包外资源验证通过；Mac已解锁并安全升级，原生输入/目录选择已核对；Claude认证及其余物理设备/系统界面仍未验收，总目标未完成。

- [57-composer-caret-race](issues/57-composer-caret-race.md)：修复引用入口和候选选择延迟恢复光标覆盖新输入的问题；延迟动画帧用例修复前红、修复后绿，桌面及HTTPS手机回归通过。

- 58真实Codex审批/结构化输入与59取消进程排空已补齐，见[58](issues/58-real-agent-controls.md)、[59](issues/59-cancel-process-drain.md)。真实工具的批准、拒绝、取消待审批、进程退出及新上下文只读恢复均通过。

- [60-interaction-timeouts](issues/60-interaction-timeouts.md)：真实stdio权限及输入请求等待后推进Tokio时钟601秒，验证超时解除和迟到答案拒绝；客户端全5项及Clippy通过。04真实审批票由此完成。

- [61-structured-input-form](issues/61-structured-input-form.md)：补齐原生结构化控件、JSON回退及失败/连点/离线/过期/停止状态；桌面和HTTPS移动回归、类型单元与打包通过。原生窗口仍待解锁。

- [62-human-initialization-timeout](issues/62-human-initialization-timeout.md)：复现并修复30秒初始化误中断人工等待；独立600秒请求时限、剩余工作预算、旧请求失效及父子进程清理通过13项客户端回归。

- [63-cursor-sync](issues/63-cursor-sync.md)：补齐15的桌面/手机游标增量、合并投影去重、并发上界、过期快照及慢订阅恢复；原生与物理设备条件仍独立待验。

- [64-plugin-operation-receipts](issues/64-plugin-operation-receipts.md)：202持久受理、幂等、固定代次、独立执行与恢复已接App SDK/插件页；47项Node、14项Host、桌面/手机、原生忙碌保护及包外验证通过。

- [65-http-error-contract](issues/65-http-error-contract.md)：统一HTTP错误信封、响应身份和客户端错误字段；阻止API落入SPA，并修复插件输入网关限制不一致；49项Node、15项Host、桌面/手机及包外验证通过。

- [67-composer-project-skills](issues/67-composer-project-skills.md)：`/` 补齐真实项目 SKILL.md 选择及正文引用发送；保持 ACP/本地命令与 `@` 文件交互，桌面及 HTTPS 手机回归通过。

- [66-generated-request-contracts](issues/66-generated-request-contracts.md)：以实际Rust请求/基本回执生成共享Schema及TypeScript，正式创建/发送接构造器，检查产物漂移与类型反例；完整业务响应仍由14跟进。

- [68-profile-contracts](issues/68-profile-contracts.md)：实际Profile保存/删除契约及设置构造器已接入，省略/null规则与修订冲突有真实Host验证；完整快照响应仍待继续。

- [69-session-run-contracts](issues/69-session-run-contracts.md)：实际Run/队列迁移为结构字段并生成SessionView响应；执行、取消、幂等、附件与历史共用模型，旧记录扩展和缺省时间有专门检查。

- [70-snapshot-attention-contracts](issues/70-snapshot-attention-contracts.md)：快照封装、手机范围过滤及待处理/决定公共字段已接生产类型；旧失效审批事件的回填兼容有红/绿验证，原始事件与消息保留。

- [72-stop-queue-transition](issues/72-stop-queue-transition.md)：停止在受理与driver启动之间持久暂停队列；空闲暂停/撤空后释放预留租约。两条实际边界红/绿回归通过，手机验证绑定当前Run身份。

- [71-profile-catalog-views](issues/71-profile-catalog-views.md)：目录及固定配置类型、异常记录隔离与摘要保护移除接入正式设置页，完整回归与打包通过。

- [73-composer-reference-menu](issues/73-composer-reference-menu.md)：`/` 分类和目录重试、`@` 文件夹清单及纯引用发送接正式输入框；桌面/手机、Host和包外验证通过，旧Host按能力标识兼容。

- [74-catalog-domain-errors](issues/74-catalog-domain-errors.md)：工作区/Profile类型化领域错误及稳定HTTP码；真实SQLite失败、22项Workbench、18项Host、Clippy和包外验证通过，其他业务错误仍由14继续。

- [75-provider-probe](issues/75-provider-probe.md)：主动环境探测、版本与CLI状态已交付；初始化不创建会话或任务，超时清理、隐私过滤、亮暗及真实双桥接器验证通过。CLI入口由76补齐。

- [76-cli-profile-selection](issues/76-cli-profile-selection.md)：配置摘要、CLI按ID探测/创建及本地传输限制已交付，完整回归与包外检查通过；02结合75由此完成。

- [78-composer-context-skills](issues/78-composer-context-skills.md)：`@` 补齐项目技能分组引用、筛选与键盘选择，正文实际进入消息；保持 `/` 指令、目录导航和权限边界，桌面/HTTPS 手机回归通过。

- [77-upstream-context-resume](issues/77-upstream-context-resume.md)：显式选择原上下文、延迟连接、权限恢复及失败不降级已完成；跨进程夹具、正式页面及真实Codex原生记忆通过。

- [79-execution-domain-errors](issues/79-execution-domain-errors.md)：发送/停止/队列领域错误、附件受理存储身份及空会话新上下文修复完成；完整check、桌面/手机、Clippy与包外检查通过。人工决定及其余旧领域错误仍由14继续。

- [80-attention-session-errors](issues/80-attention-session-errors.md)：人工决定与配置/元数据领域错误、未确认不重放、回答错误隐私和配置断线完成已交付；取消事件误记sent有红/绿修复。完整check、桌面/手机、Clippy与包外检查通过，其余旧业务错误由14继续。

- [81-creation-attachment-errors](issues/81-creation-attachment-errors.md)：创建/附件入口和配置查询错误已明确分类，创建与取消归档共享容量检查，修复多余默认项目和容量绕过；全量、桌面/手机及包外检查通过。14其余入口继续。

- [82-resource-history-errors](issues/82-resource-history-errors.md)：资源/历史错误分类、Git隔离及删除差异、特殊文件与UTF-8预览、产物并发容量和存储一致性完成；全量、桌面/手机和包外检查通过。14其余入口及52继续。

- [83-plugin-resource-inspection](issues/83-plugin-resource-inspection.md)：插件清单/App普通文件约束、有界读取、异步检查与明确错误完成；命名管道红/绿及全量、桌面/手机、包外验证通过。插件其余入口及最终实机验收继续。

- [85-cli-timeout-close-test](issues/85-cli-timeout-close-test.md)：修正macOS超时关闭的RST/EOF断言，仍严格验证连接关闭和凭据不回显；真实TCP测试三次通过，生产CLI未改。

- [84-plugin-lifecycle-errors](issues/84-plugin-lifecycle-errors.md)：插件公共生命周期/操作错误、错误隐私、候选容量/过期重查与有界复制完成；真实Worker/SQLite、全量、桌面/手机和包外验证通过。14剩余查询错误及动态响应继续。

- [86-query-domain-errors](issues/86-query-domain-errors.md)：事件/增量查询错误、存储故障公开提示及缓存storage重置完成；全量、桌面/手机及包外验证通过。远程管理仍有固定400适配，后续迁移；14/52继续。

- [87-remote-domain-errors](issues/87-remote-domain-errors.md)：远程HTTP适配已移除，状态锁/重复决定/撤销与启动失败、TLS身份保护完成；全量、桌面/手机及包外检查通过。配置保存/回显缺口待独立后续项继续，14动态类型和52实机未完成。

- [88-composer-interaction](issues/88-composer-interaction.md)：指令/引用重新聚焦、中段完整词替换、Esc事件竞争与引用简名完成；54项Node、桌面/HTTPS手机及打包烟测通过。

- [89-remote-preferences](issues/89-remote-preferences.md)：远程IP/端口持久配置、实际状态分离、轮询保留编辑及回显完成；全量、桌面/手机与包外检查通过。重新进入二维码丢失下一项继续。

- [90-remote-qr-restoration](issues/90-remote-qr-restoration.md)：当前监听二维码通过状态恢复，关闭清空/新代次替换，旧Host回退校验地址；Host、桌面/手机和重建包外烟测通过。

- [91-file-directory-navigation](issues/91-file-directory-navigation.md)：目录地址确认后切换、失败保留当前列表、层级返回与子目录独立重试已完成；55项Node、桌面/手机与打包烟测通过，文档和SVG已更新。

- [92-device-public-status](issues/92-device-public-status.md)：设备公开字段投影、四种授权状态、角色/工作区显示及共用有效性规则完成；私有字段泄漏红/绿、全量、桌面/手机及打包烟测通过。原生仍锁定，Claude仍未认证。

- [93-operation-response-contracts](issues/93-operation-response-contracts.md)：插件操作实际回执/摘要/详情与快照操作元数据使用共享类型，明确公开字段、JSON结果及旧记录兼容；全量、类型反例、桌面/手机与重建包外检查通过。14原始验收继续核对。

- [94-plugin-lifecycle-receipts](issues/94-plugin-lifecycle-receipts.md)：审计确认生命周期缺少原定operationId，已补齐本机持久入口、共用执行器和真实回执验证；正式页面由95接入。

- [95-plugin-lifecycle-ui](issues/95-plugin-lifecycle-ui.md)：正式插件页接入生命周期持久回执，保留App验证/两阶段发布和旧Host回退；网络断言、完整回归、手机权限及打包烟测通过。

## Fog

- 原上下文恢复已由77补齐，真实Codex记忆与权限已验证；其他Agent恢复仍受其协议及本机认证状态约束。


- 真实Claude认证及该工具的审批/取消仍由本机账号和实际工具能力决定；Codex路径和人工请求可控时间超时已有实测。
- 物理 iOS/Android 证书信任、弱网、锁屏及 macOS 托盘/系统通知仍待人工验收。
- 目录动态记录内容及完整领域错误分类仍见14；Snapshot封装和待处理公共字段由70补齐；SessionView与Run/队列基本响应由69补齐；请求和基本回执生成已由66交付；HTTP失败信封已由65交付；插件HTTP持久异步回执、客户端游标投影增量及长历史已独立交付。
- 公开 SDK 完整 semver/跨插件依赖、跨平台发行、签名公证后置。
