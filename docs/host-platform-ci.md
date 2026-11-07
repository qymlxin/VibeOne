# Host跨平台持续集成

`.github/workflows/host.yml` 在推送main、提交PR或手动触发时，分别在 Ubuntu 24.04、Windows Server 2022、macOS 15运行核心Host检查。矩阵任一平台失败不会取消其他平台；同一分支的新运行替代旧运行，避免重复消耗。

## 检查范围

- Node 22，使用package-lock.json执行npm ci；校验实际Rust生成契约、TypeScript正反例、插件SDK与Node运行时测试。
- Rust 1.99.1，与当前本机验证版本一致；执行workspace格式、测试和严格Clippy，构建独立vibeone-host。
- `tests/ci-host.test.mjs` 用独立临时目录与演示stdio ACP进程验证本机鉴权、Origin拒绝、创建/发送幂等、真实审批投递、Host退出及重启后的消息/Run恢复。测试不读取本机Agent账号，不调用付费模型。
- Windows使用.exe启动Host；文件路径由Node与Rust路径API生成。Unix文件权限、符号链接及进程组检查仍按实际cfg平台执行，不将跳过的Unix断言描述为Windows已验证。

Action使用经核对的固定提交：checkout v7.0.1、setup-node v7.0.0。工作流只有contents:read权限，checkout不持久保存凭据；不发布安装包、不使用项目秘密，也不执行外部fork提供的高权限工作流。

## 结果与限制

本机完整check、原生5项单元检查、workspace Clippy与新增隔离Host冒烟已通过。真实远程运行 [42322487387](https://github.com/qymlxin/VibeOne/actions/runs/42322487387)（提交d7fc47b）三平台全部通过，包含各平台独立Host启动、演示ACP、审批和重启恢复。

CI检查Host核心和Node层；没有运行Tauri桌面窗口、系统通知/托盘、原生选择器、真实模型认证、物理iOS/Android证书安装或后台行为。即使矩阵全绿，这些仍需各自的实机验收，不能据此承诺跨平台桌面发行。Windows进程树清理等平台专属行为也需专门故障验证。

GitHub语法及运行器依据：[矩阵工作流](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/run-job-variations)、[运行器选择](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job)。

## Windows验证发现的问题

首轮Windows的严格生成契约检查失败，固定Git检出换行后第二轮校验通过；没有对生成器做宽松换行比较。随后实际插件打包测试暴露作者CLI用字符串`/`前缀检查App入口，导致合法Windows路径被误拒。

作者CLI现以平台路径API的relative/isAbsolute判断目录包含关系，同时修正输出目录不能在源包内的检查。用例覆盖Windows盘符、大小写、混合分隔符、UNC共享路径，以及POSIX路径、相邻同前缀目录、父级跳转和不同驱动器；实际CLI继续验证打包/检查成功与源包内输出拒绝。第四轮实际Windows及全矩阵已通过。

第三轮Windows通过了全部61项Node检查，随后Rust/Node桥接集成发现规范路径带Windows verbatim前缀时，Node主模块解析失败（EISDIR，lstat D:）。PluginHost在启动前用固定版本dunce 1.0.5规范化Runner路径，仅在等价且安全时使用兼容表示，不盲目剥离所有前缀；库说明见[dunce canonicalize](https://docs.rs/dunce/1.0.5/dunce/fn.canonicalize.html)。本机6项真实Node桥接、严格Clippy和原生5项单元通过，第四轮实际Windows的Rust桥接、Clippy、Host构建和隔离冒烟全部通过。
