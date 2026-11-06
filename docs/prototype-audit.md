# 批准原型的实现与验收记录

状态：本轮发现的实现缺口已补齐，自动验证与包外资源验证通过；原生实机交付尚未完成，不能据此宣布全部原型验收通过。

## 范围与证据

以已批准的 `prototype/three-pane-review`（57bccce）中的工作台、八类设置、外观、会话头像和阅读导航为基准。已逐个读取实际控件及其演示处理，按用户操作核对正式入口；静态示例值由真实会话、目录、设备和文件替换。参考产品里的市场、订阅或账号管理没有成为该批准原型的功能。

“自动通过”表示实现和对应自动验证均有证据，不表示系统弹窗或真实手机也已验收。测试使用真实Rust Host、SQLite和stdio ACP演示进程，原生选择器/通知在浏览器中使用桥接夹具；真实模型另列结果。

## 工作台与会话

| ID | 原型操作 / 行为 | 正式实现入口 | 证据与状态 |
| --- | --- | --- | --- |
| W01 | 新建会话，选择工作区、Agent；目录可选 | `main.jsx` NewSession、Host Session API | 桌面真实表单、默认托管项目与Host workspace测试自动通过 |
| W02 | 选择、搜索会话；Cmd/Ctrl+K | `main.jsx`、`SessionIdentity.jsx` | 桌面搜索、无结果、快捷键与焦点自动通过 |
| W03 | 项目分组、最近列表、添加项目、侧栏开合 | `session-groups.js`、工作区设置 | 项目分组折叠、活动时间持久排序及侧栏自动通过 |
| W04 | 会话菜单中的命名/归档意图 | 标题处重命名、归档与归档筛选 | 正式操作使用直接入口；桌面与恢复测试自动通过 |
| W05 | 待处理入口与数量 | `main.jsx` attention列表 | 真实审批/输入请求定位、角色校验和处理回执自动通过 |
| W06 | 头像颜色、六种形状、关闭/移出、动画 | `SessionIdentity.jsx` | 11色/6形、即时更新、设备保存和刷新恢复自动通过；减少动画已有CSS约束 |
| W07 | 用户输入与回复分段、复制回答 | `ChatTimeline.jsx` | 原始Markdown复制、正文间距及浏览器回归自动通过 |
| W08 | 整轮过程、同类工具组、单工具详情 | `chat-timeline.js`、`ChatTimeline.jsx`、`ToolDetails.jsx` | 顺序、嵌套折叠、搜索/命令/文件解析、旧数据兼容自动通过 |
| W09 | 运行摘要滚动、思考扫光、结束停止动画 | `ActivityFeed`、主题CSS | 最新3项、状态、减少动画与移动截图自动通过；静态检测的渐变提示属于已批准状态效果 |
| W10 | 发送、停止、忙碌追加队列、撤回、暂停/继续 | `execution.rs`、`Queue` | 串行、幂等、取消宽限/子进程、失败暂停和手动暂停自动通过 |
| W11 | `/` 指令与 `@` 上下文引用 | `ComposerInput.jsx`、Host文件读取 | ACP真实命令列表、本地面板指令、目录筛选/刷新、键盘及正文传递自动通过 |
| W12 | 附件按钮、图片/文件上下文 | `Attachments.jsx`、Host附件API | 真上传、粘贴/拖放、预览、下载字节、ACP内容块、失败恢复与重启自动通过 |
| W13 | 输入区Agent/模型/权限配置 | `AgentConfigControls.jsx` | 只显示上游实际选项，select/boolean和失败回退自动通过；不冒充所有Agent都有同一权限模式 |
| W14 | 阅读刻度、当前位置、悬停预览、渐减长度 | `ConversationNav.jsx` | 真实轮次跳转及200刻度组件的End键/点击可达自动通过 |
| W15 | 阅读更早消息、停止跟随、回到最新 | `use-conversation-history.js` | 完整档案、分页、像素锚定、断线整轮缺口补齐、手机分页自动通过 |
| W16 | 当前变更摘要跳转 | `main.jsx`、`FileExplorer.jsx` | 实际文件数与Git差异；明确是工作区当前变更，包含其他工具修改，自动通过 |

## 右侧工具与链接

| ID | 原型操作 / 行为 | 正式实现入口 | 证据与状态 |
| --- | --- | --- | --- |
| P01 | 变更/文件/终端/网页切换、关闭 | `main.jsx` SessionTools / BrowserPreview | 桌面与手机真实面板操作自动通过 |
| P02 | 调宽、扩大、恢复面板宽度 | `SplitHandle.jsx`、预览标题栏 | 鼠标/键盘宽度与扩大恢复自动通过，窄屏独占预览自动通过 |
| P03 | 文件树展开/收起、筛选、选中文件、刷新 | `FileExplorer.jsx`、Host tree/read | 真实嵌套目录、空格、列表隐藏、错误及边界测试自动通过 |
| P04 | 面包屑/文件路径、只读内容、行号 | `FileExplorer.jsx`、`code-lines.js` | 实际文件正文、行号、空/二进制/截断状态自动通过 |
| P05 | 统一差异、增删颜色及数量、当前比较 | Git API、`code-lines.js` | 真实Git修改、暂存/未暂存、hunk行号与计数自动通过；未承诺任意分支编辑器 |
| P06 | 终端输出、状态、定位到对应对话 | `SessionTools.jsx`、Run关联 | 只读Agent终端/工具输出与真实runId定位自动通过；不增加任意远程Shell |
| P07 | 点击文件链接在侧边打开 | `PreviewLinks.jsx`、FileExplorer | 路径范围、文件名与完整路径、实际读取及恶意路径拒绝自动通过 |
| P08 | 点击网址、输入地址、刷新、返回/前进 | `BrowserPreview.jsx` | 隔离测试页面真实加载，地址历史和刷新入口自动通过；站点禁止内嵌时有外部入口 |
| P09 | 查看当前地址、外部打开 | 地址栏、外部打开入口、`open_external` | 地址栏显示真实完整目标，安全URL原生单元通过；默认浏览器实际打开仍待解锁核对 |
| P10 | 产物、执行记录与配置等已有功能 | SessionTools、Host artifact/config | 文件产物哈希、执行状态与配置接口自动通过；既有能力继续保留 |
| P11 | 桌面包离开源码目录独立运行 | `package-bridges.mjs`、Tauri资源与Host路径 | 56补齐两桥接器与本平台CLI；仓库外副本两个v2握手、CLI启动、网页/Worker/Provider/历史通过 |

## 八类设置

| ID | 原型操作 / 行为 | 正式实现入口 | 证据与状态 |
| --- | --- | --- | --- |
| S01 | 分类、分组意图、搜索、返回 | `SettingsCenter.jsx` | 桌面8类、手机受角色限制3类、搜索和返回自动通过 |
| S02 | 常规重连、Agent管理、数据详情 | SettingsCenter、useWorkbench | 实际连接与管理跳转自动通过，队列规则和数据路径为真实信息 |
| S03 | 历史保存、显式新上下文继续 | Host recovery、queue API | 崩溃恢复、保留消息、失效旧审批及明确继续自动通过 |
| S04 | 亮/暗/跟随系统 | AppearanceSettings、主题tokens | 系统事件、模式切换、跨刷新保存自动通过 |
| S05 | 强调色、前景/背景、独立亮暗配色、恢复 | `appearance.js`、AppearanceSettings | 颜色合法性、对比度提示、模式隔离和恢复自动通过；字体为系统默认 |
| S06 | 提醒开关与系统权限显示 | NotificationSettings、原生命令 | 查询失败、拒绝/允许、撤销刷新及关闭的桥接测试通过；macOS真正授权框/横幅待验 |
| S07 | 审批/输入/执行结束提醒及首次历史基线 | `notifications.js` | 有权限冷启动零补发、新Run提醒自动通过；插件渠道使用真实Host outbox |
| S08 | Agent选择、新建配置、名称/类型、命令/参数 | AgentSettings、Profile API | 保存修订、参数错误、固定旧修订、默认入口及移除自动通过 |
| S09 | 认证信息与启动入口状态 | Provider探测、Agent设置说明 | 入口与认证明确分开；真实Codex复验通过，Claude认证仍待用户本机完成 |
| S10 | 工作区路径输入/导入、已有目录与托管项目 | Management、Workspace API | 55已补齐路径输入、选择填入和明确导入；相对拒绝、空格目录、重复路径与Host持久化自动通过 |
| S11 | 插件路径、检查、信任、范围、JSON配置 | PluginManager、Host插件API | 真包与清单检查、权限、配置错误、范围校验及App面板/Worker自动通过 |
| S12 | 安装/更新/启停，失败保留可用版本 | PluginManager、App/Worker运行时 | 候选先准备后发布、失败回退、老代租约排空、通知消费与共享React自动通过 |
| S13 | 远程开关、IP/端口、地址/二维码/复制 | RemoteSettings、Host TLS | 真实HTTPS启动/关闭、私有地址与端口、可信TLS和手机连接自动通过 |
| S14 | 导出CA、配对码、确认/拒绝、角色/范围、撤销 | RemoteSettings、配对/设备API | 超期/凭据/工作区/角色与撤销自动通过；原生保存对话框、物理手机信任待验 |
| S15 | 存储目录、空闲重启、脱敏诊断与复制 | Management、原生HostSupervisor | 诊断允许列表、复制入口、恢复/迁移和重启过渡测试通过；实际原生Host切换仍待解锁 |

## 必须保留的未验收项

- macOS当前锁屏。实际原生窗口的新版启动、Host空闲升级、目录选择/证书保存对话框、外部浏览器、托盘与系统通知仍未完成本轮实机核对。已只读确认用户Host没有活跃执行或排队消息，但未因此停止它或丢弃原生草稿。
- 真实Codex只验证隔离工作区的握手、固定文本回复与完成；真实工具审批/执行中取消没有被演示进程替代验收。Claude复验仍为 `Authentication required`。
- HTTPS手机浏览器测试通过，物理iOS/Android证书信任、软键盘、弱网/锁屏与系统提示仍需要设备。当前实现不是可靠后台WebPush或原生手机壳。
- macOS包为本地调试产物，需Node22+及本机Agent认证，未做发行签名/公证或其他桌面平台实机验收。

这些是保留的验收缺口，不是删除原型功能的理由。实现期间发现的遗漏分别以51、54、55、56补齐；52和总目标维持未完成。

## 本轮命令与产物证据

| 检查 | 结果与具体范围 |
| --- | --- |
| `npm run check` | 通过：Node/SDK/打包器、workspace Rust、10项Host集成、崩溃恢复；不包含真实模型请求 |
| `npm run desktop:test` | 53秒完整回归通过：真实Host、目录路径导入、历史与重连、通知桥接状态、插件React及200刻度组件 |
| `npm run remote:test` | 23秒通过：可信TLS/配对/撤销、手机操作和分页/通知状态、角色与工作区拒绝 |
| `cargo clippy --workspace --all-targets -- -D warnings` | 通过 |
| 原生Cargo测试 / Clippy | 4项测试通过；原生Clippy通过；系统回调的实际窗口观察仍未完成 |
| `npm run desktop:bundle` | 通过，当前macOS调试包827.27MiB；包标识dev.vibeone.desktop，最低系统10.15 |
| `npm run bundle:smoke` | 通过：复制全部资源到仓库外，两个桥接器v2握手和原生CLI启动、可信HTTPS网页、Worker反向调用、插件Provider及历史 |
| `npm run agent:smoke -- codex claude` | Codex目标文本/end_turn通过；Claude失败，Authentication required，未冒充双工具完成 |

包内Host SHA-256：`df297d59703e77ff25107c50bc264be9bc0456bc673bb87bf9b384ac0002ec9c`。桌面Web索引与最后生产构建一致，资源清单包含当前平台桥接器和运行依赖。SVG已检查XML有效性；截图覆盖桌面亮暗、文件/差异、长过程及手机通知/历史。
