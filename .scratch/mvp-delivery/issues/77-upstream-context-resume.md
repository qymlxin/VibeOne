# 77 · 显式恢复 Agent 原上下文

Status: resolved
Type: task

## 范围

补齐core-functions中支持时显式恢复上游会话的要求，保留31的新上下文选项。使用持久上游身份和固定Profile，以ACP v2 session/resume、不请求历史回放。下一轮才连接，排队仍需显式恢复；恢复失败、状态非空闲或缺少状态同步时不发送prompt、不新建替代上下文。保留原历史和权限模式，旧审批不重放。真实Host跨进程恢复、失败回退、浏览器和实际工具验证，更新中文文档及SVG。

## Answer

已接入正式历史会话的原/新上下文选择、恢复意图持久化、下一轮原身份 ACP v2 resume、空闲状态校验、权限配置恢复及失败只读/草稿重试。队列保持暂停直到显式恢复，不重复发送旧Run或导入旧历史，失败不自动新建会话。

验证：完整check含53项Node/SDK、workspace Rust、22项Host及SQLite崩溃恢复；Clippy通过。专门桌面恢复回归20.3秒、HTTPS手机23.6秒通过。真实Codex两轮无工具验证：跨Host进程的原身份、原生随机记忆及只读模式均保持。亮暗/手机/失败截图和SVG已渲染查看。当前原生检查仍返回Mac locked，原生/Claude/物理设备不由本切片标记完成。

设计与SVG见 [原上下文恢复](../../../docs/upstream-context-resume.md)。

最终831.97MiB桌面包及仓库外smoke通过；包内Host SHA256：`057749b00ffb2f6dbc47a7d2b2453d4e901ba8a2f3ba784c31d22c0c8ab70afa`。未重启正在使用的用户Host。
