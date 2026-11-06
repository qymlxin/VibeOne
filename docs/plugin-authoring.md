# 本地插件开发与接入

插件以 JavaScript ESM 运行，可以用 JS、TS、TSX 开发，再构建成 JS。Rust Host 拥有会话、执行、权限和状态；App 插件在客户端本地注册组件，Node Worker 通过独立 Plugin RPC 执行后台处理。ACP v2 由 Host 直接连接 Agent，不通过 Plugin RPC 传递函数或代理整个 Agent 会话。

## 创建与打包

```sh
npm run build
npm run plugin:dev -- create /absolute/path/my-plugin
npm run plugin:dev -- build /absolute/path/my-plugin
npm run plugin:dev -- check /absolute/path/my-plugin
npm run plugin:dev -- pack /absolute/path/my-plugin /absolute/path/my-plugin-package
```

模板包含 `src/app.ts`、`src/worker.ts`、`plugin.json` 和 ESM `package.json`。构建工具支持 `.tsx`、`.ts`、`.jsx`、`.js`、`.mjs`；App 和 Worker 分别打包成单文件 ESM。自己的依赖需要打入产物；共享的 React、React DOM 和 SDK 保留为外部模块。打包目录包含清单和 `dist`，在桌面设置中检查并安装该目录。

App 入口可以只提供 App 部分；Host 会给 App-only 包补一个空 Worker。示例 `examples/plugins/workspace-tools` 同时演示动态 React 面板、设置、Worker 命令、反向目录读取、通知渠道和不调用模型的 ACP Provider。

## 清单

`manifestVersion: 1`、`engines.pluginApi: ">=0.1 <0.2"`、`kindVersion: 1` 为本版明确支持范围。入口必须在包目录内，安装包不允许符号链接。安装时复制到 Host 数据目录中的独立版本目录，不覆盖正在使用的版本。

支持的扩展点包括 `app.panel`、`app.command`、`settings.section`、声明式 `agent.provider` 和 Worker `notification.channel`。当前注册 API 没有实现的 view/slot 类型不应在包内声明为已支持功能。

权限列表 `hostRequirements` 当前支持 `workspace.read`、`notifications.send` 和 `agent.spawn`。用户安装前查看清单，明确勾选信任及允许访问的工作区。可选 `configurationSchema` 使用 JSON Schema 校验配置；失败不替换旧配置和旧版本。

## App Context

```ts
import React from 'react';
import { defineApp } from '@vibeone/plugin-sdk/app';

export default defineApp(ctx => {
  ctx.panels.register('my-panel', () =>
    React.createElement('p', null, '插件面板'),
  );
  ctx.commands.register('my-command', async () => {
    await ctx.services.invokeWorker('my-handler', { value: 1 });
  });
  ctx.hooks.on('workbench.changed', sessions => {
    // 本地观察，不拥有 Host 审批权。
  });
});
```

注册 ID 和类型必须预先在清单贡献中声明，注册只在 `activate` 期间开放。组件、回调、Hook 和 Scope 在客户端本地创建，不进入 JSON-RPC。

- `ctx.identity`：插件 ID、版本与代次。
- `ctx.config`：该代次配置的本地副本，更新配置通过准备新代次发布。
- `ctx.scope`：统一释放资源；`scope.add(disposer)` 逆序且仅执行一次。
- `ctx.panels.register`、`ctx.settings.register`：注册 React 函数组件，接收 `workspaceId`/`sessionId` 等宿主参数。
- `ctx.commands.register`：注册本地命令。
- `ctx.services.workbench.snapshot()`：读取当前会话、工作区和插件进度。
- `ctx.services.workbench.subscribe(listener)`：订阅宿主快照，订阅自动加入实例 Scope。
- `ctx.services.invokeWorker(handler, input, workspaceId)`：提交可序列化输入，绑定当前插件代次；过期 App 不能静默调用新代次。
- `ctx.hooks.on('workbench.changed', listener)`：接收会话快照变化；异常隔离在插件边界。

宿主共享 `react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@vibeone/plugin-sdk` 和 `@vibeone/plugin-sdk/app`。App 产物必须为单文件，不提供任意相对模块和 CSS 资源加载器。样式可使用宿主 CSS 变量和局部样式。

## Worker Context 与反向调用

```ts
import { defineWorker } from '@vibeone/plugin-sdk/worker';

export default defineWorker(registrar => {
  registrar.handle('workspace.scan', async (_, ctx) => {
    ctx.progress({ stage: 'reading' });
    return ctx.host.call('workspace.read', 'scan', { path: '.' });
  });
});
```

Rust 给每次调用分配 `requestId`、`instanceId`、`generation`、`workspaceId`、授权、超时和取消。Node 在自己的上下文中恢复本地函数、Scope、服务代理与 AbortSignal；它们不是序列化函数。`AsyncLocalStorage` 将反向 Host 调用绑定到当前调用，Host 再验证实例、代次、父调用与工作区。

工作区 API：`workspace.read/scan` 和 `workspace.read/read`，路径必须在授权工作区内。通知 API：`notifications.send/show`，输入 `{ message }`；授权与范围由 Host 检查。这些检查不限制可信插件自行使用 Node 原生文件和进程 API。

Worker 入口需要 `runtime: "node"`、`protocolVersion: 1`，默认导出 `defineWorker()`。清单中的 Worker 绑定处理器都必须完成注册；未知处理器、越权工作区和过期代次会拒绝。

## Provider 与通知消费

声明式 Provider 示例：

```json
{
  "id": "my-agent",
  "kind": "agent.provider",
  "kindVersion": 1,
  "binding": {
    "type": "declarative",
    "descriptor": {
      "name": "My Agent",
      "command": "$node",
      "args": ["$package/dist/acp-bridge.js"]
    }
  }
}
```

还需声明 `agent.spawn`，并授权目标工作区。`$node` 使用 Host 发现的 Node；`$package/` 参数相对于复制后的安装目录。Host 将 Provider 放入真实会话创建入口，持有对应代次租约并直接建立 ACP v2 连接。更新或停用不把已有会话静默迁移到新代次。

`notification.channel` 使用 `{ "type": "worker", "handler": "onEvent" }` 绑定。Host 在执行结束或产生待处理事项后传入事件类型、会话、Run、工作区和状态；不传审批提交权。通知事件与会话状态通过事务 outbox 一起保存。每次调用最多等待两秒，最多三次退避重试，失败不改变执行结果、不自动批准。通知携带稳定 `eventId`，插件应据此去重；调用 `notifications.send/show` 时可以传 `idempotencyKey: event.eventId`，避免重复生成本地通知。过期的旧待处理通知在重启时丢弃。

## 更新与失败处理

更新经过检查、复制独立目录、准备 Worker、准备 App 注册、提交、发布。App 激活失败会丢弃候选；旧面板和旧 Worker 继续使用。提交竞争或代次不匹配会拒绝，已有调用和 Provider 租约保留旧代次，最后持有者释放后清理。

App `activate` 阶段主要注册贡献和资源；Worker 候选尚未发布时，不应依赖当前路由执行后台业务。停用阻止新调用和新会话，已有 Provider 会话按代次租约排空。

当前自动重启预算为 0；进程崩溃或配置错误由管理页显示，用户修正后重新启用。跨插件依赖解析、公开市场、签名、恶意插件沙箱和稳定的跨版本公共 SDK 尚未交付。当前 SDK 为仓库内 `0.1`，不要将本版当作已经冻结的公开兼容承诺。
