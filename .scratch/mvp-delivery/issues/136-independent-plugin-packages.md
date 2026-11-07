# 136 · 独立插件包与远程安装

Status: resolved
Type: task

将文件、变更、终端、网页从桌面构建拆至 VibeOnePlugin 的四个目录；使用统一 manifest、Host prepare/commit、AppRuntime 和停用流程。支持从 GitHub 仓库目录下载、检查、授权安装及独立更新，保留现有界面。仅进行局部验证。

## Answer

四个包已独立发布到 https://github.com/qymlxin/VibeOnePlugin ，分别位于 files/changes/terminal/browser。桌面移除静态实现与第二套本地开关；本地和远程统一Host/AppRuntime生命周期。仓库下载、来源提交记录、授权安装、直接启停、代次更新及Scope原生资源回收已接通。局部验证：远程克隆真实仓库、四包安装、子目录正文、停用/重启用/更新代次均通过；SDK及授权/资源清理测试通过，Web构建和Host编译通过。未进行全量回归。
