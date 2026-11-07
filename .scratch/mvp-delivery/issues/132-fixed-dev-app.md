# 132 · 固定桌面开发入口与旧包清理
Status: resolved
Type: task
Blocked by: 131

只保留固定~/Applications/VibeOne.app开发入口，使用Vite热更新；主进程修改重启同一应用。清理旧生成包及其LaunchServices注册，保留用户数据和独立Host。发行包输出到不索引的构建目录，不再每次UI修改都生成app。

## Answer

固定开发应用已安装到~/Applications/VibeOne.app；npm run desktop复用入口，Vite服务缺失时自动启动，React/CSS热更新，Electron源码修改后同路径自动重启。Host已从共享资源目录启动。7个旧包已注销并移至废纸篓，Spotlight查询仅剩固定入口；会话数据保留。已确认两次同路径重启、自动启动Vite及热更新事件。发行构建默认输出到desktop-builds.noindex。
