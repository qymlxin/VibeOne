# 65 · HTTP错误信封与客户端错误身份

Status: resolved
Type: task

## 范围

补齐14中稳定错误契约的一片，保留现有业务状态码和中文说明。统一401/403、404/405、非法JSON/参数/内容类型、过大请求、冲突及服务错误的JSON信封，添加主机生成的requestId用于对账。客户端保留status/code/requestId，未知错误码与旧主机说明保持兼容。

- 错误响应使用实际Rust DTO序列化；已有专用错误码保持原样，不把中文文本作为客户端分支依据。
- 请求正文解析及路由错误也遵循同一信封；不把成功响应或文件正文改写为错误。
- WS成功升级不变，HTTP升级失败使用相同错误信封；权限与Cookie不放入错误身份。
- 用真实Host验证不同失败入口及客户端错误字段；更新中文文档。
- 此票不等于完成全部DTO代码生成或替换所有内部Result<String>，14继续跟踪其余部分。

## Answer

已通过HTTP中间件统一4xx/5xx错误，包含鉴权、路由与Axum正文/查询解析失败；真实Rust ErrorResponse DTO序列化code/error/status/requestId，保留已有专用码、中文业务说明及Allow/Retry-After，未知字段不继续转发。每次API响应由主机生成响应身份，HTTP错误禁止缓存。显式API兜底避免手机SPA把未知API返回为HTML。

共享客户端HostRequestError保留实际status、code、requestId，旧格式按状态补通用码，未知新码保留。成功响应/文件/WS升级保持原格式。未把所有内部Result<String>冒充已改为领域错误。

验证：真实Host覆盖401/403、404/405、非法JSON/查询、415、422、413、409与专用404码；真实HTTP测试覆盖503及Retry-After/字段剔除；2项客户端兼容检查通过。全量49项Node/SDK、Rust工作区、15项Host和恢复、54.8秒桌面、23.4秒HTTPS手机与Clippy通过。

额外复现64输入上限不一致：约300KB插件参数被通用256KiB限制返回413。操作路由改用600KiB正文限制，保留规范化参数512KiB约束；修复前红、修复后受理并实际执行，550KB参数仍拒绝。修改后对应插件/HTTP集成及Clippy再次通过。

重建828.34 MiB调试包，仓库外验证structuredErrors、pluginOperations、cursorSync、网页/Worker/Provider/历史、两个桥接器与CLI均通过。Mac仍锁屏，未操作用户真实Host。错误流程是普通HTTP失败信封，用字段/状态表说明，未为单步返回另画冗余流程图。
