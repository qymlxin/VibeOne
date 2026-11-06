# 66 · 生成共享请求与回执契约

Status: resolved
Type: task

## 范围

将现有强类型HTTP请求和基本回执移到实际服务端使用的contracts模块，从同一Rust类型生成JSON Schema与TypeScript。客户端请求构造器使用生成类型，正式桌面/手机发送路径接入，生成漂移进入检查。保持原来的默认值、可空字段、JSON名称及现有业务校验。

本票覆盖创建会话、消息提交、队列、会话元数据、工作区导入、审批决定、附件上传和候选Ticket，以及创建/提交回执和HTTP错误DTO。Profile、完整会话/Run/队列响应及ACP动态Schema仍继续由14跟踪，不用若干any类型宣称全部业务模型完成。

## Answer

服务端8组请求和3组基本响应定义已统一到contracts；同源生成JSON Schema/TypeScript，正式创建/提交通过类型构造器发送，生成漂移与类型正反检查纳入npm test。Serde默认值/null/camelCase语义由实际Schema验证器和反序列化对照；故意污染生成文件会失败并已恢复。

当前工作树全量检查通过：51项Node/SDK、Rust工作区（Workbench12项）、16项Host、SQLite恢复、Clippy。最近同一实现的桌面54.9秒、HTTPS手机23.5秒及重建包外检查通过，SVG已查看。Profile及完整业务响应仍由14跟进，未把整体目标标记完成。
