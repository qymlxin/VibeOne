# 124 · 统一创建项目弹窗
Status: resolved
Type: task
Blocked by: none

创建项目采用紧凑居中弹窗，与创建Agent复用外壳。内容为名称和源文件夹，支持添加/移除多个目录。首页侧栏加号、设置中的创建入口均使用此组件。

## Answer

提取CompactDialog供项目创建及Agent配置共用。名称输入、系统目录选择、多目录列表、移除与手动路径已实现，侧栏加号和项目设置入口接入。保留Host校验与重试时同一项目ID。功能说明已更新。

Web构建通过；隔离Host完成两目录创建、持久化、取消检查，亮暗实图已查看。未启动实际Agent或改动用户项目数据；独立Electron包位于target/electron-project-dialog。
