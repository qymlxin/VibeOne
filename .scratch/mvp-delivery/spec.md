# VibeOne 开发任务拆解

状态：已批准并开始执行；基线：`ea6594f`（2026-11-06）。本文件制定后续开发顺序，不表示所有任务已实现。最新调整：采用 ACP v2 Draft，并将 Tauri 桌面体验入口提前到本轮。

对应 [实施计划](../../docs/implementation-plan.md)、[核心功能](../../docs/core-functions.md) 和 [插件设计](../../docs/plugin-design.md)。任务存放于本目录的 `issues/`；它们是执行记录，不另建远程任务仓库。

## 已有基础

React 紧凑原型及亮暗模式；TypeScript Worker SDK、Scope/Registry；Node ESM 执行、调用上下文、双向 RPC、进度、取消与超时；Rust 插件进程监督和授权；工作区扫描示例；内存中的候选代次发布与租约。

这些基础继续复用，不重做。App 插件 SDK、持久插件目录、正式桌面程序、真实 ACP Agent、业务数据库和手机后端尚未实现。现有内存代次管理不等于插件安装产品已完成。

## 交付批次

| 批次 | 对应阶段 | 任务 | 完成后可体验 |
| --- | --- | --- | --- |
| A | 接入验证（P0） | 01–06 | CLI 能与两个真实工具对话，至少一个可真实审批；App 插件生命周期实验通过。 |
| B | 可靠 Host（P1） | 07–15 | 无 GUI 也能持久化会话、执行、排队和审批；API 与事件可供客户端接入。 |
| C | 桌面可用版（P2） | 16–23 | 在 Tauri 内真实聊天、审批、看历史和 diff，并实际加载本地插件。 |
| D | 手机控制（P3） | 24–26 | 真实手机完成配对、查看、发送、取消、审批、重连和设备撤销。 |
| E | 核心 MVP 验收（P3 出口） | 27 | macOS 可安装，两个真实工具及真实手机完整链路通过。 |
| F | 第三方插件开发体验（P4） | 28–29 | 对外 SDK、依赖兼容、作者构建和打包联调可用。 |

依赖主线：`A → B → C → D → E → F`。每个任务以自身依赖为准：06 可与 ACP 接入交错推进；24 的手机 TLS 部署实验应在 B/C 期间提前做，以便尽早确认可信访问方式，但不跳过设备授权或将手机原型视为手机交付。

A 阶段确定协议与能力之后才冻结业务契约；P0 结束不代表具备可靠持久状态。07 与 17 持续验证独立 Host 存活，24 验证实际手机网络，不能用插件子进程退出测试代替这两项验收。

## 当前交付

ACP v2 客户端基础完成，Tauri 桌面预览已提前交付；Codex 真实对话通过，Claude 认证阻塞。HTTP/WS 与桌面会话当前为内存实现，不将可靠 Host、全部桌面任务或 P0 整体标记完成。详见 [兼容与体验记录](../../docs/acp-compatibility.md)。

## 完整任务列表

| 编号 | 任务 | 批次 | 直接依赖 |
| --- | --- | --- | --- |
| 01 | [ACP 客户端与可控假 Agent](issues/01-acp-harness.md) | A | 已有基础 |
| 02 | [Agent Provider 描述与环境探测](issues/02-provider-discovery.md) | A | 01 |
| 03 | [第一个真实 Agent 的 CLI 对话](issues/03-first-agent-cli.md) | A | 02 |
| 04 | [真实权限审批与补充输入](issues/04-real-approval-cli.md) | A | 03 |
| 05 | [第二个真实工具与接入兼容矩阵](issues/05-second-agent-matrix.md) | A | 04 |
| 06 | [App 插件 SDK 与最小动态面板](issues/06-app-plugin-sdk.md) | A | 01 |
| 07 | [独立 Host 生命周期与本地鉴权](issues/07-host-lifecycle.md) | B | 05, 06 |
| 08 | [SQLite 迁移与重启恢复](issues/08-storage-recovery.md) | B | 07 |
| 09 | [工作区导入与访问范围](issues/09-workspaces.md) | B | 08 |
| 10 | [本地会话与 Agent Profile 绑定](issues/10-sessions.md) | B | 02, 09 |
| 11 | [Run 状态机、排队与取消](issues/11-run-actor.md) | B | 03, 08, 10 |
| 12 | [事务事件、游标与 outbox](issues/12-events-outbox.md) | B | 08, 11 |
| 13 | [审批与补充输入的可靠状态机](issues/13-attention-state.md) | B | 04, 11, 12 |
| 14 | [Host HTTP 命令与查询 API](issues/14-host-http.md) | B | 07, 09, 10, 11, 12, 13 |
| 15 | [WS 订阅与共享客户端](issues/15-event-client.md) | B | 12, 14 |
| 16 | [只读 diff 与产物查询](issues/16-workspace-changes.md) | C | 09, 11, 14 |
| 17 | [Tauri 桌面壳与 Host 连接](issues/17-tauri-shell.md) | C | 07, 14, 15 |
| 18 | [工作区与 Agent 设置页面](issues/18-workspace-agent-ui.md) | C | 02, 09, 10, 14, 17 |
| 19 | [真实聊天与执行时间线](issues/19-chat-ui.md) | C | 11, 15, 18 |
| 20 | [桌面审批与补充输入](issues/20-attention-ui.md) | C | 13, 19 |
| 21 | [历史、变更查看与诊断界面](issues/21-history-diagnostics-ui.md) | C | 08, 16, 19, 20 |
| 22 | [本地插件目录与管理界面](issues/22-local-plugin-product.md) | C | 06, 08, 14, 17 |
| 23 | [Provider 与通知扩展接入主流程](issues/23-plugin-consumers.md) | C | 02, 10, 12, 19, 22 |
| 24 | [手机可信 HTTPS 配对与设备授权](issues/24-pairing-https.md) | D | 05, 07, 14, 15 |
| 25 | [手机真实会话与审批页面](issues/25-phone-ui.md) | D | 19, 20, 21, 24 |
| 26 | [手机重连、竞争审批与撤销设备](issues/26-phone-recovery-revoke.md) | D | 15, 24, 25 |
| 27 | [核心 MVP 验收与 macOS 打包](issues/27-mvp-release.md) | E | 05, 16, 17, 21, 23, 26 |
| 28 | [插件兼容性、依赖与升级加固](issues/28-sdk-compatibility.md) | F | 22, 23, 27 |
| 29 | [插件作者工具与公开 SDK 文档](issues/29-plugin-author-tools.md) | F | 28 |

## 第一批执行顺序

1. **01 ACP 客户端与假 Agent**：先解决真正的 ACP 通信、双向请求和取消，不改现有 Plugin RPC 承担 Agent 通信。
2. **02 Provider 探测**：明确工具在哪里、怎样启动、是否认证以及支持什么能力。
3. **03 第一个真实 Agent**：通过 CLI 在真实工作区发送一条输入，看到流式响应并能取消。到这里即可体验第一次真实对话。
4. **04 真实审批**：CLI 人工回应真实工具权限请求，验证批准、拒绝及失效。
5. **05 第二工具验证**：验证统一接口与能力差异；与 **06 App 插件实验**一起完成接入验证。

首选验证候选为 Claude Code 与 Codex，不能在未验证 SDK、桥接器和工具版本前承诺特定能力。模型账号和真实授权只通过用户本机已有认证或明确的认证流程使用；缺失时记录具体阻塞，继续完成无需凭据的协议、状态机和 UI 工作。

## 提交与验收规则

- 一次提交对应一个可解释、可验证的切片。一个任务可以分多次提交，不能积攒到整个批次结束才提交。
- 任务开工前完成评审，将依赖与验收确认清楚；任务执行状态按 [本地任务约定](../../docs/agents/issue-tracker.md) 维护。
- 纯样式或文字改动做相应构建、视觉或链接检查；协议、事务、审批竞争、取消、恢复与授权写有意义的集成测试。
- 每个批次产出运行入口、验收结果、固定版本及仍未实现项；真实工具和手机证据不能由 mock 替代。
- 桌面和手机沿用当前紧凑 UI、系统字体和亮暗主题。先替换数据与交互，再针对实际状态优化，不重新发散设计。
- Session 的创建、存储与执行归属由 Rust Host 负责；插件提供 Provider、界面、命令、设置与通知实现，不接管鉴权和最终审批提交。

## 本轮范围与后置项

核心 MVP 以 27 的验收为出口。公开插件 SDK 的稳定性和分发工具属于 28–29；本地插件能力已在 06、22、23 纳入首版，不等待第三方生态才落地。

首版不做插件市场、云端账号、公网 Relay、原生手机壳、任意远程终端、自动 Git 合并、完整 IDE 或跨会话自主 Agent 编排。可靠锁屏推送、多 Host、Worktree 并行队列、外部历史导入和原生 Worker 另行拆解。

## 排期方法

先按 01–06 验证接口与接入风险，再用实际完成的切片校准剩余工作量。现阶段不把原计划中的总量估计当作剩余交付日期。29 个任务的规模不同，不能用每个任务固定半天或固定一个提交来估算。
