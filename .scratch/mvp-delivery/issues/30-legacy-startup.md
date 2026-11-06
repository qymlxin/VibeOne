# 30 · 旧会话升级后 Host 启动失败

Status: resolved
Type: task

## 问题

桌面显示 Load failed；重新连接报 Host 启动超时。日志为 `invalid type: null, expected a sequence`。旧投影缺少新列表字段，恢复时可变 JSON 索引将缺失项变为 null，SessionView 反序列化失败。

## Answer

恢复前规范化旧执行列表，反序列化兼容新增列表的 null 值；原消息和会话 ID 保留。先运行回归复现原错误，再验证旧数据库、旧导出与连续重启通过；存储、崩溃恢复及 Clippy 通过。用户本地数据库在修复启动前使用 SQLite backup API 备份。
