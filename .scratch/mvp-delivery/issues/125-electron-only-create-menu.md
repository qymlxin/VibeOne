# 125 · 清理Tauri及统一新建入口
Status: resolved
Type: task
Blocked by: none

迁移Electron共用资源、移除Tauri源码/依赖/入口；记录IPC、HTTP和WebSocket通信链路。顶部加号改为创建Agent/项目下拉，打开弹窗保持当前页面。

## Answer

资源准备迁至target/desktop-resources，图标移至apps/desktop/assets/icons；移除Tauri源码、配置、npm包和脚本，并迁移包资源检查路径。通知命令与native适配器改为Electron专用。Rust Host未删除；新增HTTP/WS与IPC通信说明及SVG。

顶部加号采用创建菜单，提供Agent和项目选项；打开弹窗不进入其他项目、不卸载对话。首页Agent弹窗可选所属项目，创建后保留当前页面。项目空间继续提供会话组和显示分组入口。

资源准备（含Host构建）、Web构建、两个资源工具测试以及隔离UI检查通过；确认页面/草稿保持、Agent/项目弹窗可打开。未执行真实Agent任务或全量回归。已退出旧包并打开target/electron最新版，原有Host与会话保留。
