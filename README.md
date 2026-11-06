# VibeOne

基于 ACP 的 Agent 工作台设计，面向桌面操作与手机远程查看、控制和审批。

当前提供 Tauri + React 主要功能预览版：独立 Rust Host、ACP v2 对话与人工处理、执行队列、SQLite 恢复、工作区文件和 Git 差异、文本产物、JS/TS 插件管理，以及 HTTPS 手机配对和控制。已自动验证的范围与待实机项目见 [体验与验收清单](docs/acceptance.md)，插件开发见 [作者指南](docs/plugin-authoring.md)。Codex 隔离对话验证通过，Claude Code 当前受本机认证阻塞；不将浏览器测试当作真实手机验收。

## 体验桌面应用（macOS）

```sh
npm ci
npm run desktop
```

当前macOS包要求10.15或更高版本；从源码构建需要Rust工具链和Xcode Command Line Tools。启动后选择 Agent 即可创建会话；目录留空会在 `~/.vibeone/projects/` 自动创建新项目，也可选择已有目录。默认“本地演示”不调用模型，可发送 `/approve` 体验审批、`/wait` 体验停止；Codex 和 Claude Code 使用本机已有认证。桥接器启动入口可用不代表已认证，缺少认证或网络失败会显示在会话中。

构建不依赖 Vite 开发服务器的本地 `.app`：`npm run desktop:bundle`。产物位于 `apps/desktop/src-tauri/target/debug/bundle/macos/VibeOne.app`；这是本地开发包，尚未做正式签名、公证和分发验收。`npm run desktop:build` 构建 release 包。包内包含锁定ACP桥接器、生产依赖和本平台CLI，不依赖源码目录；`npm run bundle:smoke` 从仓库外副本验证。资源与边界见[桌面打包说明](docs/desktop-bundle.md)。

桌面通过 loopback HTTP/WS 与 Host 通信；手机使用另行开启的私有地址 HTTPS/WSS 入口和可撤销设备凭据。关闭窗口隐藏到托盘，退出桌面与停止 Host 分开。会话、消息、审批决定、队列、配置、插件目录和通知 outbox 保存在本机 SQLite 中。正常执行结束后继续下一条，失败或取消后暂停；重启不自动续跑旧任务。历史可显式点击“在新上下文继续”后发送，恢复队列也需明确选择新的 Agent 上下文；不冒充原 Agent 的上下文恢复。

工作台提供对话、文件、只读变更、执行记录、文本产物和 Agent 当前配置；设置中管理工作区、Profile、可信本地插件、设备与通知。手机按工作区和角色共享会话事实，支持新建、发送、审批、补充输入、停止、查看变更和重连。UI 继续沿用紧凑布局、系统字体及亮暗模式。

统一数据根目录优先为 `~/.vibeone`（主目录不可写时，桌面自动使用现有可写的 `~/.config/vibeone` 或 `~/.local/share/vibeone`，实际路径显示于设置），数据库为 `~/.vibeone/vibeone.sqlite3`，插件与托管项目也位于此处。首次升级会在旧 Host 空闲后停止它，将旧应用数据目录原子迁移到此处，并保留旧目录的兼容别名；有执行时先附着旧 Host，待空闲后重启迁移，不覆盖已有目标目录。已有工程目录不会被搬动。可通过 `VIBEONE_DATA_DIR` 或 Host `--data-dir` 覆盖数据位置。

插件可用 JS/TS/TSX 开发，构建为 JS ESM；支持 App 面板、命令、设置、声明式 ACP Provider、通知渠道和 Node Worker。安装与更新经过候选准备和发布，已有 Provider 会话保留代次租约。SDK 与插件均为仓库内预览 API，未开放插件市场与跨插件依赖解析。

ACP 显式使用 `protocolVersion: 2`（官方 Draft），Rust SDK 锁定 `5.0.0`，不静默降级 v1。prompt 回执表示接受，执行完成等待独立的会话 idle 更新。Plugin RPC v1 保持独立。

测试：`npm run check` 验证 SDK、作者工具、ACP、队列、审批竞争、Host、文件范围、插件消费与 SQLite 恢复；`npm run desktop:test` 验证真实 Host 的桌面与动态 React 插件；`npm run remote:test` 验证 TLS、配对、角色、手机页面与设备撤销。浏览器测试在 macOS 默认使用本机 Chrome，其他环境可设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE`。

完整消息与工具记录支持分页阅读、旧数据回填与重连补齐；运行窗口保持有界。通知设置分别管理本设备开关和系统授权。详见 [持久会话历史](docs/conversation-history.md) 与 [通知权限](docs/notifications.md)。

## 运行真实插件链路

环境：Node.js 22+、npm 10+、支持 Rust 2024 edition 的 Rust 工具链。

```sh
npm ci
npm run build
cargo run -p vibeone-host -- plugin scan --workspace .
```

也可运行 `npm run plugin:scan` 扫描当前项目。CLI 启动 Node runner，加载由 TS 编译出的工作区工具插件；插件通过反向 RPC 请求 Rust 读取所选目录，再返回结构化结果。进度与插件日志写入 stderr，最终 JSON 结果写入 stdout。目录只读、最多返回 500 项；绝对路径、父目录越界和符号链接越界会被拒绝。

该CLI命令用于源码内验证；桌面独立包见上文。插件尚无操作系统级沙箱。插件作为可信本机代码运行，宿主 API 的路径限制不限制其自行使用 Node API。

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

- [体验与验收清单](docs/acceptance.md)
- [插件作者指南](docs/plugin-authoring.md)
- [文档索引](docs/README.md)
- [核心功能设计](docs/core-functions.md)
- [插件机制设计](docs/plugin-design.md)
- [服务划分与通信协议](docs/diagrams/plugin-service-boundaries.svg)
- [插件后台调用时序](docs/diagrams/plugin-call-flow.svg)
- [架构设计](docs/architecture.md)
- [实施计划](docs/implementation-plan.md)
- [原型说明](prototype/README.md)

功能设计文档使用中文。工程技能配置位于 `AGENTS.md` 与 `docs/agents/`，任务追踪采用本地 Markdown。
