# 93 · 插件后台操作的公开响应契约

Status: resolved
Type: task
Blocked by: 92

## 目标

回执、摘要、详情和快照操作元数据使用实际Rust类型生成共享契约。摘要只发布明确字段，详情保留任意JSON结果及false/0/null，按持久目录身份查询。

## 验收

- 公开响应不透传指纹、未知私有存储字段，摘要不携带结果。
- 同键重复仍返回相同回执；损坏身份不发布无法对账的假回执。
- 旧记录可缺省说明/时间，未知状态保留给客户端核对；不补造时间。
- 类型生成、存储/真实Worker/HTTP、桌面/手机回归通过，文档和SVG更新。

## Answer

实际HTTP受理/列表/详情和Snapshot操作元数据使用PluginOperationReceipt/Summary/Record/ListResponse，由同一Rust结构生成Schema/TypeScript。公开投影过滤指纹和未知私有字段，摘要不含结果；详情保留false/0/显式null/嵌套JSON，缺少结果仍保持缺省。旧说明和时间不补造；目录身份异常拒绝假回执，摘要保留活跃状态参与重启保护。

验证：存储测试先复现未知字段透传；57项Node/SDK、49项Workbench、37项Host、崩溃恢复、Clippy和新增类型正反例通过。桌面69.1秒、HTTPS手机23.7秒及后台操作亮暗截图通过；SVG已查看。833.95MiB桌面包与包外烟测通过，Host SHA256 c77de2836990da10eaf74c18728a62b199baf1511d7976cafe2af7016017fca4。

只读核对实际Host同PID39028可访问，5会话/0活动/0队列；未停止或重启它，也未据此替代原生草稿检查。14需按原始验收继续复核，52的原生/Claude/物理设备项目仍未完成。
