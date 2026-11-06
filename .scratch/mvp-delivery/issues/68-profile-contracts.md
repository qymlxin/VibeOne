# 68 · Profile 请求与响应契约

Status: resolved
Type: task

## 范围

补齐Agent配置保存/删除的实际请求和响应类型，纳入生成共享契约并接入正式设置调用。保留修订冲突、Provider/启动路径校验、已固定会话配置和删除行为。可选字段可以省略；提供字段时必须为正确非null类型，避免null修订意外绕过冲突保护。

## Answer

ProfileRequest直接用于HTTP解析；ProfileRecord在写入前校验实际记录；保存/删除返回ProfileResponse。设置页接共享saveProfile/removeProfile构造器，未设置的command/args仍省略。可选请求字段一旦提供必须非null，明确拒绝revision:null，防止其被误当无修订条件；此解析收紧已在功能文档记录。

Schema与Serde一致性、TypeScript正反例、真实Host构造器及工作区/配置集成（3项）通过。51项Node/SDK、Workbench13项、workspace Clippy、54.8秒桌面、23.4秒HTTPS手机及重新打包/仓库外资源检查通过。最新包828.82MiB，Host SHA256 b5735ff97f338027afe0a124308a0e704efa2c212d33beb5a42ad6503da9661e。CUA仍明确Mac locked，未动用户Host。Profile全量快照、完整Session/Run响应等仍由14跟进。
