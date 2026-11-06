# 02 · Agent Provider 描述与环境探测

Status: claimed
Type: task
Batch: A
Blocked by: 01

## 目标

建立 Agent 接入描述和 Profile 配置；启动参数最终由 Host 校验。

## 依赖

[01](./01-acp-harness.md)。本任务为待评审计划，尚未开始实现。

## 验收

- 探测可执行文件、桥接器和版本，区分未安装、未认证与不兼容。
- 描述启动命令、参数、能力与工作目录；不把凭据明文写入配置或日志。
- CLI 能选择 Agent Profile；有无 load、附件、模式切换等能力都有明确结果。

## 建议提交切片

1. Provider 描述与启动参数校验。
2. 环境探测与 Profile 选择。

每个切片完成相关验证后单独提交；新增失败或代码变动才扩大验证。未通过本任务验收时不标记完成。

## 实现进度

已接入演示、Codex、Claude 启动描述与入口发现；完整 Profile 持久化、版本探测和认证流程 UI 尚未完成。
