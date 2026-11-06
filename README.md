# VibeOne

基于 ACP 的 Agent 工作台设计，面向桌面操作与手机远程查看、控制和审批。

当前包含功能与架构设计、可交互 React 原型、品牌 SVG，以及 P0 插件 SDK、Node 执行引擎和 Rust CLI Host。插件跨进程调用已实现；Tauri 桌面壳、真实 Agent 接入、数据库与手机后端仍待实现，UI 原型继续使用内存模拟数据。

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
