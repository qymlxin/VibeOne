import type { Channel } from "./native.ts";

export interface PluginRecordSummary {
  id: string;
  generation: number;
  enabled?: boolean;
  capabilities?: string[];
  workspaces?: string[];
  [key: string]: unknown;
}

export interface PluginWorkbenchSnapshot {
  plugins?: PluginRecordSummary[];
  workspaces?: Array<{ id: string; path: string; name?: string }>;
  sessions?: Array<{ id: string; workspace: string }>;
  pluginEvents?: Array<{ pluginId?: string; [key: string]: unknown }>;
  call(endpoint: string, body?: unknown): Promise<unknown>;
  invokePlugin(id: string, body: Record<string, unknown>): Promise<unknown>;
}

export interface NativeServiceAdapter {
  available: boolean;
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
  streamChannel(): { events: Channel; dispose: () => void };
}

/** 为受信任的前端应用插件构造带权限与工作区边界校验的 SDK 服务对象 */
export function pluginServices(
  record: PluginRecordSummary,
  latest: { current: PluginWorkbenchSnapshot },
  snapshot: { current: PluginWorkbenchSnapshot },
  listeners: { current: Set<() => void> },
  native: NativeServiceAdapter,
) {
  const { invoke, streamChannel } = native;
  const resourceId = (id: unknown) =>
    `${record.id}:${record.generation}:${String(id)}`;
  const terminals = new Set<unknown>();
  const browsers = new Set<unknown>();
  const channels = new Map<Channel, () => void>();
  let disposed = false;
  let cachedSource: PluginWorkbenchSnapshot | undefined;
  let cachedValue:
    | {
        pluginEvents: Array<{ pluginId?: string; [key: string]: unknown }>;
        sessions: Array<{ id: string; workspace: string }>;
        workspaces: Array<{ id: string; path: string; name?: string }>;
      }
    | undefined;

  const current = (): PluginRecordSummary => {
    const value = latest.current.plugins?.find((p) => p.id === record.id);
    if (disposed || !value?.enabled || value.generation !== record.generation) {
      throw new Error("插件已停用或版本已替换");
    }
    return value;
  };

  const permission = (name: string) => {
    if (!current().capabilities?.includes(name)) {
      throw new Error(`插件未获授权：${name}`);
    }
  };

  const authorized = (
    session: { id: string; workspace: string } | undefined,
    plugin: PluginRecordSummary = record,
  ): boolean =>
    Boolean(session) &&
    Boolean(
      plugin.workspaces?.some((id) =>
        latest.current.workspaces?.some(
          (w) => w.id === id && w.path === session?.workspace,
        ),
      ),
    );

  const findSession = (id: string) => {
    const value = latest.current.sessions?.find((s) => s.id === id);
    if (!value || !authorized(value, current())) {
      throw new Error("此会话的工作目录未授权给插件");
    }
    return value;
  };

  const owns = (set: Set<unknown>, id: unknown) => {
    if (!set.has(id)) {
      throw new Error("插件资源不存在");
    }
  };

  const desktop = {
    available: native.available,
    streamChannel() {
      current();
      const value = streamChannel();
      channels.set(value.events, value.dispose);
      const dispose = () => {
        channels.delete(value.events);
        value.dispose();
      };
      return { ...value, dispose };
    },
    async invoke(
      command: string,
      args: Record<string, unknown> = {},
    ): Promise<unknown> {
      const terminal = command.startsWith("terminal_");
      const browser = command.startsWith("browser_");
      permission(terminal ? "desktop.terminal" : "desktop.browser");
      if (!terminal && !browser && command !== "open_external") {
        throw new Error("插件桌面命令不受支持");
      }
      if (command === "terminal_open") {
        const source = latest.current.sessions?.find(
          (s) => s.workspace === args.cwd && authorized(s, current()),
        );
        if (!source) {
          throw new Error("终端工作目录未授权");
        }
        if (!channels.has(args.events as Channel)) {
          throw new Error("终端事件通道未注册");
        }
        terminals.add(args.id);
      } else if (terminal) {
        owns(terminals, args.id);
      }
      if (command === "browser_open") {
        if (!channels.has(args.events as Channel)) {
          throw new Error("网页事件通道未注册");
        }
        browsers.add(args.id);
      } else if (browser) {
        owns(browsers, args.id);
      }
      const result = await invoke(
        command,
        args.id ? { ...args, id: resourceId(args.id) } : args,
      );
      if (command === "terminal_close") {
        terminals.delete(args.id);
      }
      if (command === "browser_action" && args.action === "close") {
        browsers.delete(args.id);
      }
      return result;
    },
  };

  const services = {
    desktop,
    workbench: {
      snapshot: () => {
        const source = snapshot.current;
        if (source !== cachedSource) {
          cachedSource = source;
          cachedValue = {
            pluginEvents: (source.pluginEvents ?? []).filter(
              (e) => e.pluginId === record.id,
            ),
            sessions: (source.sessions ?? []).filter((s) => authorized(s)),
            workspaces: (source.workspaces ?? []).filter((w) =>
              record.workspaces?.includes(w.id),
            ),
          };
        }
        return cachedValue;
      },
      subscribe: (listener: () => void) => {
        listeners.current.add(listener);
        return () => listeners.current.delete(listener);
      },
      request: async (endpoint: string, body?: unknown) => {
        const url = new URL(endpoint, "https://plugin.local");
        if (url.origin !== "https://plugin.local") {
          throw new Error("插件请求地址无效");
        }
        const match =
          /^\/sessions\/([^/]+)\/(tree|file|diff|changes|artifacts)$/.exec(
            url.pathname,
          );
        if (!match || !match[1]) {
          throw new Error("插件请求不受支持");
        }
        findSession(decodeURIComponent(match[1]));
        permission(body === undefined ? "workspace.read" : "artifact.write");
        if (body !== undefined && match[2] !== "artifacts") {
          throw new Error("插件不支持此写入操作");
        }
        return latest.current.call(endpoint, body);
      },
    },
    invokeWorker: (
      handler: string,
      input: unknown,
      workspaceId?: string,
    ) =>
      latest.current.invokePlugin(record.id, {
        handler,
        input,
        workspaceId,
        generation: record.generation,
      }),
  };

  return {
    services,
    async dispose() {
      disposed = true;
      for (const dispose of channels.values()) {
        dispose();
      }
      channels.clear();
      for (const id of terminals) {
        await invoke("terminal_close", { id: resourceId(id) }).catch(() => {});
      }
      for (const id of browsers) {
        await invoke("browser_action", {
          id: resourceId(id),
          action: "close",
        }).catch(() => {});
      }
      terminals.clear();
      browsers.clear();
    },
  };
}
