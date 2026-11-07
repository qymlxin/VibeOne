# 134 · 文件树子目录空白
Status: resolved
Type: task
Blocked by: none

展开路径带末尾斜杠，目录缓存使用不同键。规范化目录读取键，子目录应能展示与打开。

## Answer

读取与展开统一规范化路径，修复末尾斜杠造成的缓存键不一致；目录关闭后可重新请求，失败后能折叠再展开重试。隔离Host/浏览器复现原缺陷，修复后config/settings.json可展开并打开正文。
