# 50 · 原型附件与图片发送

Status: resolved
Type: task

## 范围

对应 docs/prototype-completion.md 中的附件入口与用户提供的图片/文件引用体验。实施前检查当前ACP v2 SDK的ContentBlock与prompt能力字段、Host消息/队列/持久存储及远程范围校验，不依据旧版本协议记忆实现。

## 验收

- 真正选择/粘贴/拖放本机文件，草稿展示可移除附件；图片显示缩略预览，纯文本与目录引用语义明确。
- 附件经Host授权、大小/类型/内容校验及私有持久保存，以服务端ID关联会话和Run；不接受任意主机绝对路径或远程跨工作区引用。
- 与消息队列、幂等键、失败保留、撤回、重启历史共同工作，不能只做本机图片卡片。
- 按上游实际能力编码ACP内容块；不支持的类型明确报错，不能假称已传给Agent。首次连接能力未知时的流程需设计清楚。
- 桌面及HTTPS手机验证实际上传与ACP接收，覆盖拒绝类型、超限、越权和重复提交；更新中文文档及必要SVG。

## 已确认的实现依据

本机锁定Rust SDK 5.0.0的session/v2.rs提供send_prompt_blocks(Vec<ContentBlock>)；schema 1.15.1的v2/content.rs定义Image与Resource。AgentCapabilities.session.prompt.image / embeddedContext为对象型能力（{}表示支持），不能按v1布尔字段判断。当前Host全局body上限256KiB，附件路由需单独受限放宽；授权中间件已将session下GET映射read、其他POST映射operate，并校验工作区。

实施方案见 docs/attachments.md。原生窗口当前因Mac锁屏未能升级核对，后续只在确认空闲后重启Host。

## Answer

完成私有SQLite附件存储、服务端ID/去重/配额与归属、独立受限上传路由、按会话预览/下载、未引用草稿清理及Run引用持久化。输入框接选择/粘贴/拖放、缩略图、只附件发送、草稿保留和失败Run恢复；ACP使用真实typed内容块与capabilities.session.prompt对象能力，不做媒体能力猜测。

Host/ACP验证字节长度和SHA-256、无媒体能力纯文本、跨会话/重复/超限/伪图片拒绝与历史保留；桌面、HTTPS手机、崩溃恢复通过，实际下载字节一致。Clippy和Impeccable通过，已看桌面/手机截图。中文文档与SVG已同步；原生实机因锁屏仍留到52核对。
