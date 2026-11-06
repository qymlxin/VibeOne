# 56 · 桌面包内的ACP桥接器依赖

Status: resolved
Type: task

## 范围

包外资源审计发现内置Codex/Claude桥接器仍回退至编译时开发仓库node_modules。桌面包必须带锁定版本的适配器和生产依赖闭包，保留嵌套版本、可执行权限及许可证。Node22+和模型认证仍由本机提供，不复制认证数据。

## 验收

- 构建从当前锁定安装解析dependencies/peerDependencies与已安装的optionalDependencies，缺少必需依赖即失败，不复制devDependencies或任意源码路径。
- 正式Tauri资源与Host环境明确指向包内bridges，不依赖源码目录或全局桥接器。
- 合成依赖树验证嵌套不同版本及缺失必需依赖；包外临时副本验证两个适配器的严格ACP v2握手和本平台CLI二进制可启动，不调用模型。
- 包外Host/HTTPS网页、Worker反向上下文、插件Provider及历史检查继续通过。更新打包说明与架构资源图；真实Claude认证仍独立记录。

## Answer

已构建并打包两个锁定适配器及125个当前平台生产依赖包，保留嵌套版本、可执行权限和许可证，生成相对路径清单。Tauri为Host明确设置包内桥接器路径，指定路径不再回退到开发仓库或全局程序；本地开发也使用准备好的资源。全局未锁定版本的描述如实标识。

验证：合成依赖树覆盖嵌套冲突版本、必需peer、开发依赖排除、缺失必需依赖与锁版本不匹配拒绝；完整check通过。macOS包827.27MiB，仓库外副本中两个适配器严格v2握手、两本平台CLI版本命令、可信HTTPS静态页/JS、Worker上下文、插件Provider与持久历史全部通过。workspace与原生Clippy通过。Node和认证仍外部提供，未复制用户凭据；原生窗口/真实Claude认证仍未宣称通过。
