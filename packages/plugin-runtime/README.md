# Node 插件执行引擎

TypeScript 编写，构建后由 Node.js 22+ 运行；入口为 `dist/main.js`。Rust Host 创建一个 runner 进程，其中可以激活多个 `instanceId + generation` 逻辑实例。标准输入输出只用于 JSON-RPC 2.0，控制台日志重定向到 stderr。

从仓库根目录执行 `npm run build`，再运行 `npm run plugin:scan` 验证跨语言调用。协议实现位于 `src/rpc.ts`，插件上下文和生命周期位于 `src/engine.ts`。

已实现的方法：

| 方法 | 用途 |
| --- | --- |
| `plugin/initialize` | 握手，`protocolVersion: 1` |
| `plugin/activate` | 校验并加载包，初始化指定实例与代次 |
| `plugin/invoke` | 执行 handler，支持 workspaceId 与 timeoutMs |
| `plugin/cancel` | 按实例、代次和原请求 ID 取消 |
| `plugin/deactivate` | 停止接收调用，取消当前调用并清理实例资源 |
| `plugin/health` | 返回实例与未完成执行数量 |
| `plugin/progress` | Node → Host 进度通知 |
| `host/call` | Node → Host 异步能力请求 |

Host 是身份与授权来源。Node 在本地创建 ctx，使用 AsyncLocalStorage 关联执行归属；父请求、实例和代次通过 RPC 显式关联。控制消息与反向响应持续读取，不等待 handler 完成后才读取下一条。

初始化 Scope 随实例释放，handler Scope 随调用完成释放；调用侧宿主代理显式保留父请求和取消信号，避免外部回调丢失调用归属。Rust 只接收与真实调用匹配的进度，协议损坏时关闭通道并终止 runner。CLI 退出时提供最多 2 秒的插件资源清理时间，随后终止进程。

P0 限制：单帧约 1 MiB，最多 64 个实例、64 个未结束 handler、128 个待返回的宿主调用；超时或取消后不配合退出的 handler 继续占用执行容量。Node 不能抢占同步死循环，Host 可终止整个进程，影响其中所有插件。未实现 OS 沙箱、原生 Worker、自动重启、依赖排序、完整 semver 兼容解析、配置更新和事件订阅。

插件必须将 Worker 导出为 `defineWorker()` 返回的默认 ESM 对象。每代升级应使用完整、独立的包目录；入口 URL 的缓存标记不会递归刷新相同路径下的所有依赖。插件不能依赖修改同一目录就能更新全部模块。
