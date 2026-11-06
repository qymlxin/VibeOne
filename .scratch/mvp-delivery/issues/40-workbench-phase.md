# 40 · 右侧工具和安全预览

Status: resolved
Type: task

## 范围

按已批准原型实施，详见 docs/workbench-redesign.md。复用真实 Host 链路，每阶段验证、更新文档并提交。

## Answer

右侧工具接入真实 Host 文件/差异/产物和 Agent 投影；链接通过隔离网页面板，工作区文件链接经本地解析后仍由 Host 复验。面板可调整宽度，网页加载/超时与外部打开可见。构建与链接安全模型测试通过，完整浏览器回归由 43 验证。
