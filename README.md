# VibeOne

基于 ACP 的 Agent 工作台设计，面向桌面操作与手机远程查看、控制和审批。

当前包含功能与架构设计、可交互 React 原型及品牌 SVG。Rust Host、Tauri 桌面程序、插件 SDK 和真实 Agent 接入仍待实现；原型只使用内存模拟数据。

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
