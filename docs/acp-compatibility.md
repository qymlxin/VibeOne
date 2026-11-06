# ACP v2 接入与桌面验证记录

验证日期：2026-11-06；环境：当前 macOS 工作区。以下区分已经观察到的结果与后续验收目标，不将演示 Agent 等同于真实编码工具。

## 协议与固定版本

| 项目 | 当前版本或选择 |
| --- | --- |
| ACP 协议 | `protocolVersion: 2`，官方 Draft；不自动降级 v1 |
| Rust SDK | `agent-client-protocol = 5.0.0`，开启 `process` 与 `unstable_protocol_v2` |
| Schema | `agent-client-protocol-schema 1.15.1`，由 Cargo.lock 固定 |
| Codex 适配器 | `@agentclientprotocol/codex-acp 2.5.0`，由 package-lock.json 固定 |
| Claude 适配器 | `@agentclientprotocol/claude-agent-acp 0.101.0`，由 package-lock.json 固定 |
| 桌面 | Tauri Rust 2.12.5；CLI / 前端 API 2.12.4 |

v2 的 prompt 响应仅确认消息被接受。更新处理器先于请求安装，按消息类型和 messageId 维护投影，等待活动状态后的 idle 及停止原因，不把早到的初始 idle 当成本轮完成。官方仍将 v2 标为 Draft，SDK 的主版本号与协议版本不是同一个概念。[Rust SDK v2 说明](https://agentclientprotocol.github.io/rust-sdk/protocol-v2.html)、[ACP v2 执行生命周期](https://agentclientprotocol.com/protocol/v2/prompt-lifecycle)。

## 已观察到的结果

| 路径 | 握手与会话 | 消息与完成 | 审批 / 取消 |
| --- | --- | --- | --- |
| 本地演示 | 真实 stdio、官方客户端严格 v2 解析通过 | chunk 与快照无重复，提前状态更新、idle 完成通过 | 合成权限请求、允许、拒绝与协议取消测试通过；不调用模型 |
| Codex | v2 握手与 session/new 通过 | 真实对话、思考摘要、工具执行与结构化补充输入通过 | 真实批准/拒绝、旧请求失效、取消待审批、工具进程退出及新上下文只读配置恢复通过 |
| Claude Code | v2 握手与 session/new 通过 | 实际 prompt 进入 `idle / error`，错误为 `Authentication required` | 被本机认证阻塞，尚未验收 |

真实工具检查在独立临时目录中执行，仅在烟测自有工作区进行测试写入和长耗时命令，没有读取或修改本项目文件。Codex的成功不代表已有两个完整工具。Claude的认证由用户在本机完成，本轮没有修改认证文件、凭据或默认工具配置。

## 桌面已验证范围

- 已生成并打开原生 `VibeOne.app`，在真实窗口中完成创建会话、演示权限请求、选择“允许一次”及查看结果。
- React 集成测试使用真实独立 Host 和 stdio 演示进程；只替代目录选择与连接发现的原生桥接，不模拟消息或审批结果。
- 覆盖发送、审批、停止、亮暗切换、WS 断开后重连快照、最小 960×640 窗口，以及查看历史时保留滚动位置和显式跟随最新消息。
- 独立包不依赖 Vite；Host 通过 loopback HTTP/WS 提供业务，Tauri IPC 仅用于启动/发现与目录选择。HTTP 校验认证与 Origin，WS 首帧认证，不把连接密钥放在 URL。

## 复验入口

补充诊断：用户反馈等待期间看不到思考内容后，用独立临时工作区完成了真实 Codex 链路复验。适配器发送 2 条 `agent_thought_chunk`，Host 合成 1 条 `thought` 消息并正常结束。摘要通道已经接入，但不能据此保证每轮都发送摘要。新增界面回归验证 chunk 与快照不重复、思考摘要标签，以及运行中无输出时的等待反馈；不生成不存在的摘要。

```sh
npm run check
npm run desktop:test
npm run desktop
```

真实工具的人工显式烟测为 `npm run agent:smoke -- codex` 或 `npm run agent:smoke -- claude`，会使用对应工具的本机认证实际发送验证输入，不加入默认测试套件。桌面中也可选择对应工具手动发送任务。

## 当前实现与待验范围

会话、Run、队列、人工决定、Profile、插件目录和事件已接入 SQLite；重启中断未完成执行，旧审批失效，队列不自动继续。支持显式在新上下文执行暂停队列，旧消息 ID 按连接隔离。桌面已接入文件引用、差异、产物、配置和 App 插件；手机已接入 HTTPS/WSS、配对、角色和撤销。客户端仍通过通知后获取快照恢复；完整消息/工具历史已增加独立档案与分页，客户端仍未使用事件增量 reducer。详见 [持久历史](conversation-history.md)。

真实Codex的审批、结构化输入、进程取消与配置恢复已有实测；Claude仍返回Authentication required，其他配置组合仍需分别验证。物理手机的CA信任、网络、锁屏/弱网，以及托盘、系统通知和正式签名分发保持待验。详细步骤、证据区分和限制见 [验收清单](acceptance.md)。

## 本轮完整原型补齐后的真实工具复验

`npm run agent:smoke -- codex claude` 中，Codex返回目标文本并以end_turn结束，Claude仍返回Authentication required。随后显式运行 `npm run agent:controls` 验证真实批准、拒绝、取消待审批、旧请求失效、实际工具进程退出和只读配置恢复；另以 `npm run agent:controls -- --input-only` 验证计划模式的真实结构化补充输入、非法答案拒绝和结果返回。停止行为与SVG见 [停止执行与进程排空](cancellation.md)。这些是独立Host验证，不替代原生窗口或物理手机验收。
