# 本机浏览器对比记录

日期：2026-11-07。只读安装包检查和用户授权的页面诊断，不复制账号或浏览器配置。

## 证据

- 本机目标：`/Applications/ChatGPT.app`，版本`26.1029.61003`，build `24614`。
- REA `open_binary`识别launcher为arm64 Mach-O，SHA256 `e25946854a71aa4ccc6d5dc3d28b22e65c6882bfc28fbb3f10dc809e262b865d`。
- REA `search_strings`返回`provider_unavailable`：Ghidra/Hopper/IDA/Kuna均未配置。没有获得原生反编译伪代码，不声称取得完整源码。资源检查与strings属于普通shell工具证据，不伪装成REA反编译结果；REA会话已关闭。
- 实际安装包包含`Codex Framework.framework/Versions/156.0.8078.79`；framework普通strings含Chromium名称。
- 自建仅回显浏览器属性的localhost页面，Codex内置浏览器实际显示`Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36`；cookies=true，webdriver=false。
- 同一页面VibeOne实际显示`Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)`；cookies=true，webdriver=false。UA缺少Version与Safari产品标记。
- 百度首页通过HTTPS打开；搜索路径出现HTTP跳转及空白结果。用户报告二维码，受控复现没有确认二维码本身，不能把一切登录/风控行为都认定为UA原因。

## 改动

保留Tauri/WebKit，使用与其内核相符的桌面Safari兼容UA，不假装自己是Chrome。导航记住已经成功请求HTTPS的主机，同一主机后续HTTP导航升级为HTTPS，保留查询及片段。未建立HTTPS的HTTP地址保持原行为。悬浮文件标题使用不透明主题面板色、独立层叠与底边界，路径目录淡化、文件名突出。

Chromium不是可移植到Tauri中的一段页面JS。真正保持相同内核需要引入Chromium浏览器组件及进程、存储、更新和分发机制，不能声称本次已复制其引擎或私有源码。

## 修复后实测

重新打包后，搜索`1111`进入`wappass.baidu.com/static/captcha/tuxing_v2.html`，页面标题明确为“百度安全验证”。确认是真实站点验证，未尝试解题、绕过或迁移其他浏览器Cookie。HTTPS降级修复已由实际导航及3项局部检查覆盖，但搜索验证问题不能标为彻底解决。
