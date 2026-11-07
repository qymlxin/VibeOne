# 131 · 首页文件/变更黑屏
Status: resolved
Type: task
Blocked by: none

隔离复现首页工具路径：Cannot read properties of undefined (reading 'busy')。文件工具必须自行提供产物保存状态，标签页需隔离渲染异常。

## Answer

文件工具自行提供产物保存状态，首页不再依赖会话页传入对象；每个工具标签页隔离渲染异常并提供重试。隔离浏览器检查变更与文件均通过，原生窗口也已确认两者可展示；未运行全量回归。
