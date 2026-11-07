# 114 · 网页兼容性与差异吸顶标题

Status: resolved
Type: task
Blocked by: none

## 要求

分析本机Codex浏览器与网页搜索跳转差异，修复可确认的浏览兼容性问题。差异文件标题吸顶时遮住下方代码，保持清晰层次。快速迭代，必要局部验证即可。

## 已观察

本机Codex 26.1029.61003带Chromium156；本地诊断页实测完整Chrome UA。VibeOne同页实测WebKit UA缺少Version/Safari产品标记，cookies=true。百度搜索曾降到HTTP并空白，尚未在受控场景确认二维码本身。REA已打开本机launcher并取得SHA256，但缺少Ghidra/Hopper/IDA/Kuna，未获得原生伪代码；安装包字符串和运行诊断作为独立证据，不声称取得完整源码。

## Answer

对比已完成：Codex实际Chromium156，VibeOne为WebKit且默认UA缺少Safari产品标记；未取得私有原生源码。修复完整桌面WebKit标识、同主机HTTPS降级、文件标题不透明吸顶与路径层级，Web/Rust构建及3项局部检查通过，桌面已更新。搜索复测确认为百度安全验证，未消除真实站点验证；由115继续记录，不能宣称浏览问题彻底修复。详见browser-comparison-114.md。
