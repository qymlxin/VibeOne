# 69 · 会话与执行队列响应契约

Status: resolved
Type: task

## 范围

将Run/队列从无类型JSON记录迁移为实际使用的Rust结构，从实际会话投影生成响应Schema/TypeScript。保留旧会话缺省列表、历史记录缺少时间字段、附件、扩展字段、幂等及队列/取消/恢复行为。上游ACP动态对象继续明确为JsonValue，不把全部原始协议强行固定为当前模型。

## Answer

实际SessionView的runs/queue已使用RunRecord。执行、完成/取消、幂等、队列操作、产物关联、附件保留及历史回放均改为结构字段；生产类型生成对应Schema/TypeScript。保留Run未知扩展、旧列表缺省/null，缺少时间不补造。新模型为旧记录缺少的key/error补null、数组补空列表；损坏身份或错误类型不冒充有效Run。消息/工具/审批等ACP动态对象仍为明确JsonValue，完整Snapshot和待处理业务模型由14继续跟进。

Schema/实际序列化测试验证私有标志不输出、旧字段默认、扩展往返、坏队列与文件元素拒绝；TypeScript正反例验证Run身份与队列元素。生成器明确支持无约束注释Schema和开放对象索引，未引入any回退。

完整检查通过：51项Node/SDK、workspace Rust（Workbench14项）、16项Host、SQLite恢复、Clippy；桌面55.1秒、HTTPS手机23.6秒以及828.89MiB桌面重建和仓库外资源检查通过。新SVG已实际渲染查看。Host SHA256 0d3da57f5c31a0266effa5b865940c77864dbc3c2ac7bd11dd50a9cb5d626bc2。CUA仍返回Mac locked，未操作用户Host，整体原型目标仍未完成。
