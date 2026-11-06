# VibeOne

基于 ACP 的 Agent 工作台设计，面向桌面操作与手机远程查看、控制和审批。

当前包含 Tauri + React 桌面开发预览版、独立 Rust Host、ACP v2 客户端，以及 JS/TS 插件 SDK 和 Node 执行引擎。桌面可操作真实 Host 的会话、消息、审批和取消；另保留原先的模拟数据 UI 原型。已接入 SQLite 本地历史；手机配对及完整 MVP 验收仍待实施。

## 体验桌面应用（macOS）

```sh
npm ci
npm run desktop
```

需要 Rust 工具链和 Xcode Command Line Tools。启动后选择工作目录和 Agent，创建会话后发送第一条消息。默认“本地演示”不调用模型，可发送 `/approve` 体验审批、`/wait` 体验停止；Codex 和 Claude Code 使用本机已有认证。桥接器启动入口可用不代表已认证，缺少认证或网络失败会显示在会话中。

构建不依赖 Vite 开发服务器的本地 `.app`：`npm run desktop:bundle`。产物位于 `apps/desktop/src-tauri/target/debug/bundle/macos/VibeOne.app`；这是本地开发包，尚未做正式签名、公证和分发验收。`npm run desktop:build` 构建 release 包。

当前桌面通过仅监听 loopback 且需要认证的 HTTP/WS 连接独立 Host。关闭窗口不停止 Host；重开应用会连接同一主机。会话、消息、审批快照与工作区保存在本机 SQLite 数据库。重启后历史可查看，未结束执行标记为中断，旧审批失效；恢复的非空会话暂时只读，请新建会话开始新的执行。支持标题搜索、重命名、归档和已保存工作区选择；运行中暂不提供下一轮消息排队。

如果设置页提示当前主机仅在运行期间保留会话，先结束所有执行，再点击“保存会话并升级主机”。升级会先导出旧版会话，随后重启并导入 SQLite，不自动续跑。数据库位于应用数据目录的 `vibeone.sqlite3`；macOS 默认目录为 `~/Library/Application Support/dev.vibeone.desktop/`。

ACP 显式使用 `protocolVersion: 2`（官方 Draft），Rust SDK 锁定 `5.0.0`，不静默降级 v1。prompt 回执表示接受，执行完成等待独立的会话 idle 更新。Plugin RPC v1 保持独立。

测试：`npm run check` 验证插件、ACP、Host 与 SQLite 崩溃恢复；`npm run storage:test` 可单独检查崩溃恢复与旧版快照导入；`npm run desktop:test` 验证 React 界面连接真实本地 Host 的流程，macOS 默认使用已安装的 Google Chrome，其他环境可设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE`。

## 运行真实插件链路

环境：Node.js 22+、npm 10+、支持 Rust 2024 edition 的 Rust 工具链。

```sh
npm ci
npm run build
cargo run -p vibeone-host -- plugin scan --workspace .
```

也可运行 `npm run plugin:scan` 扫描当前项目。CLI 启动 Node runner，加载由 TS 编译出的工作区工具插件；插件通过反向 RPC 请求 Rust 读取所选目录，再返回结构化结果。进度与插件日志写入 stderr，最终 JSON 结果写入 stdout。目录只读、最多返回 500 项；绝对路径、父目录越界和符号链接越界会被拒绝。

这是源码仓库内的 P0 验证命令，尚未提供独立安装包或操作系统沙箱。插件作为可信本机代码运行，宿主 API 的路径限制不限制其自行使用 Node API。

验证：`npm run check`（构建、Node 子进程集成测试、Rust 跨语言测试）。Rust 测试依赖 Node 构建产物，单独执行 `cargo test --workspace` 前先运行 `npm run build`。

代码入口：`packages/plugin-sdk`、`packages/plugin-runtime`、`crates/plugin-host`、`crates/host`；示例位于 `examples/plugins/workspace-tools`。

## 运行原型

```sh
npm ci
npm run prototype
```

访问 `http://127.0.0.1:4173`。支持三种桌面布局、手机预览、亮暗主题、审批与离线状态模拟。

构建检查：`npm run prototype:build`。

## 设计入口

- [文档索引](docs/README.md)
- [核心功能设计](docs/core-functions.md)
- [插件机制设计](docs/plugin-design.md)
- [服务划分与通信协议](docs/diagrams/plugin-service-boundaries.svg)
- [插件后台调用时序](docs/diagrams/plugin-call-flow.svg)
- [架构设计](docs/architecture.md)
- [实施计划](docs/implementation-plan.md)
- [原型说明](prototype/README.md)

功能设计文档使用中文。工程技能配置位于 `AGENTS.md` 与 `docs/agents/`，任务追踪采用本地 Markdown。
