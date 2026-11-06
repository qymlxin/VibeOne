# VibeOne 设计文档

版本：0.4 · 2026-11-06。本文档集描述产品与技术设计；已实现范围以实施计划中的进度为准，图中运行记录、设备和数据均为界面示例。

| 文档 | 阅读目标 |
| --- | --- |
| [桌面资源与打包](desktop-bundle.md) | 包内ACP桥接器/CLI、资源路径与包外验证 |
| [HTTP错误契约](http-errors.md) | 统一错误信封、稳定错误码、响应身份和旧主机兼容 |
| [插件后台操作回执](plugin-operations.md) | 202受理、幂等、持久结果、断线对账及重启中断 |
| [游标增量同步](cursor-sync.md) | WS通知、HTTP授权增量、快照恢复与客户端去重 |
| [持久会话历史](conversation-history.md) | 完整档案、分页、旧数据回填与阅读位置 |
| [通知与系统授权](notifications.md) | 本设备开关、实际权限查询与事件基线 |
| [原型逐项验收](prototype-audit.md) | 每个批准原型操作的实现落点、自动证据与实机缺口 |
| [原型补齐清单](prototype-completion.md) | 批准原型功能的实际交付与待验状态 |
| [附件与图片](attachments.md) | 上传、持久附件、媒体能力与ACP内容块链路 |
| [停止执行与进程排空](cancellation.md) | 取消受理、进程清理与新上下文配置恢复 |
| [补充信息表单](structured-input.md) | 按Agent字段回答、JSON回退、错误保留与提交状态 |
| [输入框指令与引用](composer-interactions.md) | `/` 指令、`@` 文件引用、键盘操作与发送链路 |
| [体验与验收](acceptance.md) | 当前可体验功能、自动验证、实机清单与已知边界 |
| [插件作者指南](plugin-authoring.md) | JS/TS/TSX 创建、构建、打包、Context、扩展点与更新规则 |
| [主要功能设计](core-functions.md) | 当前 UI 基线下的核心范围、用户操作、队列与执行规则、模块职责和开发切片 |
| [插件机制设计](plugin-design.md) | JS/TS 作者体验、App 动态注册、Node/native Worker、SDK、生命周期和验收 |
| [领域术语](../GLOSSARY.md) | Workspace、Session、Run、审批和队列的统一含义 |
| [架构设计](architecture.md) | 系统分层、状态归属、协议边界、持久化和部署 |
| [功能实现设计](functional-implementation.md) | 每项功能的操作、接口、流程、异常与验收 |
| [UI 与交互设计](ui-specification.md) | 桌面和手机的信息架构、组件、状态与适配 |
| [实施计划](implementation-plan.md) | 开发顺序、工作量、验证矩阵与阶段出口 |
| [本地开发任务](../.scratch/mvp-delivery/spec.md) | 29 个执行任务、依赖、验收条件与逐功能提交切片 |
| [ACP v2 兼容记录](acp-compatibility.md) | 锁定版本、真实 Codex 对话结果、Claude 认证缺口与当前桌面体验范围 |
| [交互原型说明](../prototype/README.md) | 三种桌面布局、手机审批与模拟状态操作 |

## 图示索引

所有图均为可编辑 SVG，使用相对路径嵌入文档，无远程字体、脚本或外部图片依赖。

| 图 | 内容 |
| --- | --- |
| [桌面资源结构](diagrams/desktop-resources.svg) | Tauri、Host、包内桥接器/Worker与本机认证 |
| [持久历史链路](diagrams/conversation-history.svg) | 事务保存、分页、重连合并与阅读锚点 |
| [通知权限](diagrams/notification-permission.svg) | 本设备偏好、Tauri IPC与系统授权 |
| [系统架构](diagrams/system-architecture.svg) | 客户端、Host、Agent、插件和存储 |
| [核心工作闭环](diagrams/core-workflow.svg) | 工作区、Agent 配置、会话、执行、人工决定和结果检查 |
| [执行与下一轮队列](diagrams/run-control.svg) | 单会话串行、忙碌输入、人工等待、取消及异常后的队列暂停 |
| [审批时序](diagrams/approval-sequence.svg) | 持久化、跨端处理、竞争提交和失效 |
| [插件更新](diagrams/plugin-lifecycle.svg) | 声明包、可选 Worker、候选发布与旧代排空 |
| [插件运行结构](diagrams/plugin-runtime.svg) | 插件控制通道、宿主可信内核、JS App、Node/native Worker 与独立 ACP 通道 |
| [服务划分与通信协议](diagrams/plugin-service-boundaries.svg) | 客户端、Tauri 壳、Rust Host、Worker、Agent 与内嵌数据库的调用边界 |
| [插件调用时序](diagrams/plugin-call-flow.svg) | HTTP 受理回执、Worker RPC、反向宿主调用、异步事件和最终结果 |
| [断线恢复](diagrams/reconnect-flow.svg) | 身份校验、事件续传、快照切换与客户端投影 |

## 设计约束

- Host 是运行事实的唯一权威，客户端 UI 不能自行批准或执行任务。
- 状态变化必须有回执；运行中、等待审批、取消中和离线不混为一个状态。
- 插件通过预置扩展点贡献功能，声明和逻辑执行分开；公共契约在原型后冻结。
- 文档图示是设计示意，不表示功能已交付，也不表示按钮具备交互能力。

系统架构、审批、插件生命周期和重连图通过 [生成脚本](tools/generate_svgs.py)维护：在仓库根运行 `python3 docs/tools/generate_svgs.py`。修改后需同时检查 SVG XML、文档链接和实际渲染效果。

核心工作流、执行队列、插件运行结构、服务划分与调用时序由 [generate_core_diagrams.py](tools/generate_core_diagrams.py) 维护，运行 `python3 docs/tools/generate_core_diagrams.py` 生成。当前已确认紧凑 UI 原型作为阶段视觉基线，主要功能已经接入真实 Host；最新实现与待验状态以验收清单为准。

界面以 [交互原型](../prototype/README.md) 和 [UI 规范](ui-specification.md) 为准，不再维护早期静态界面图、比较调研或过程评审记录。
