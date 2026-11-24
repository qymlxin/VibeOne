import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ArrowLeft, Download, FolderOpen, Plug, Search } from "lucide-react";
import * as jsx from "react/jsx-runtime";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import type { JsonValue } from "@vibeone/client-contracts";
import * as sharedSdk from "@vibeone/plugin-sdk";
import {
  AppRuntime,
  defineApp,
  type AppDefinition,
  type AppRegistration,
} from "@vibeone/plugin-sdk/app";
import { chooseWorkspace } from "./api.ts";
import { Alert } from "./components/ui/alert.tsx";
import { Badge } from "./components/ui/badge.tsx";
import { Button } from "./components/ui/button.tsx";
import { Card } from "./components/ui/card.tsx";
import { Input } from "./components/ui/input.tsx";
import { Select } from "./components/ui/select.tsx";
import {
  buildDefaultPluginConfig,
  LocalPluginInstall,
  type LocalInspectionManifest,
} from "./LocalPluginInstall.tsx";
import { invoke, streamChannel } from "./native.ts";
import { operationPresentation } from "./plugin-operations.ts";
import { PluginIcon } from "./plugin-presentation.tsx";
import {
  pluginServices,
  type PluginHostBridge,
  type PluginWorkbenchSnapshot,
} from "./plugin-services.ts";
import { PluginDetails } from "./PluginDetails.tsx";
import {
  RemotePluginInstall,
  type PluginsController,
} from "./RemotePluginInstall.tsx";
import type { PluginRecord, WorkbenchLike } from "./types.ts";
import "./plugin-center.css";

declare global {
  interface Window {
    __vibeoneReact?: unknown;
    __vibeoneJsx?: unknown;
    __vibeoneSdk?: unknown;
    __vibeoneReactDOM?: unknown;
    __vibeoneReactDOMClient?: unknown;
  }
}

let sharedInstalled = false;
function sharedModules() {
  if (sharedInstalled) {
    return;
  }
  sharedInstalled = true;
  window.__vibeoneReact = React;
  window.__vibeoneJsx = jsx;
  window.__vibeoneSdk = { ...sharedSdk, defineApp };
  window.__vibeoneReactDOM = ReactDOM;
  window.__vibeoneReactDOMClient = ReactDOMClient;

  const moduleUrl = (global: string, names: string[], defaultExport = false) =>
    URL.createObjectURL(
      new Blob(
        [
          `${defaultExport ? `export default window.${global};` : ""}${names.map((name) => `export const ${name}=window.${global}.${name};`).join("\n")}`,
        ],
        { type: "text/javascript" },
      ),
    );

  const imports = {
    react: moduleUrl(
      "__vibeoneReact",
      Object.keys(React).filter(
        (name) => name !== "default" && /^[A-Za-z_$][\w$]*$/.test(name),
      ),
      true,
    ),
    "react-dom": moduleUrl(
      "__vibeoneReactDOM",
      Object.keys(ReactDOM).filter(
        (name) => name !== "default" && /^[A-Za-z_$][\w$]*$/.test(name),
      ),
      true,
    ),
    "react-dom/client": moduleUrl(
      "__vibeoneReactDOMClient",
      Object.keys(ReactDOMClient).filter(
        (name) => name !== "default" && /^[A-Za-z_$][\w$]*$/.test(name),
      ),
    ),
    "@vibeone/plugin-sdk": moduleUrl(
      "__vibeoneSdk",
      Object.keys({ ...sharedSdk, defineApp }),
    ),
    "react/jsx-runtime": moduleUrl("__vibeoneJsx", ["jsx", "jsxs", "Fragment"]),
    "@vibeone/plugin-sdk/app": moduleUrl("__vibeoneSdk", ["defineApp"]),
  };

  const map = document.createElement("script");
  map.type = "importmap";
  const nonce = document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce;
  if (nonce) {
    map.nonce = nonce;
  }
  map.textContent = JSON.stringify({ imports });
  document.head.append(map);
}

async function definition(source: string): Promise<AppDefinition> {
  sharedModules();
  const url = URL.createObjectURL(
    new Blob([source], { type: "text/javascript" }),
  );
  try {
    const mod = (await import(/* @vite-ignore */ url)) as {
      default: AppDefinition;
    };
    return mod.default;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function usePlugins(
  workbench: WorkbenchLike,
  hostBridge?: { current?: PluginHostBridge },
): PluginsController {
  const [error, setError] = useState("");
  const runtime = useRef<AppRuntime | null>(null);
  if (!runtime.current) {
    runtime.current = new AppRuntime((err) => setError(String(err)));
  }

  const snapshot = useMemo(
    () => ({
      sessions: workbench.sessions,
      workspaces: workbench.workspaces ?? [],
      pluginEvents: workbench.pluginEvents ?? [],
    }),
    [workbench.sessions, workbench.workspaces, workbench.pluginEvents],
  );
  const snapshotRef = useRef<PluginWorkbenchSnapshot>(
    snapshot as unknown as PluginWorkbenchSnapshot,
  );
  snapshotRef.current = snapshot as unknown as PluginWorkbenchSnapshot;
  const latest = useRef(workbench);
  latest.current = workbench;
  const listeners = useRef(new Set<() => void>());
  const busy = useRef(new Set<string>());
  const failed = useRef(new Set<string>());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const app of runtime.current?.snapshot() ?? []) {
        void runtime.current?.unload(app.identity.pluginId);
      }
    };
  }, []);

  const registrations = useSyncExternalStore(
    runtime.current.subscribe,
    runtime.current.snapshot,
  );

  useEffect(() => {
    for (const listener of listeners.current) {
      listener();
    }
    runtime.current?.emit(
      "workbench.changed",
      workbench.sessions as unknown as sharedSdk.Json,
    );
  }, [snapshot]);

  async function prepare(
    record: PluginRecord,
    app: { source: string } | null | undefined,
  ): Promise<AppRegistration | null> {
    if (!app || !runtime.current) {
      return null;
    }
    const bridge = pluginServices(
      record as unknown as Parameters<typeof pluginServices>[0],
      latest as unknown as Parameters<typeof pluginServices>[1],
      snapshotRef,
      listeners,
      {
        invoke,
        streamChannel,
        available: Boolean(window.vibeoneDesktop),
      },
      hostBridge,
    );
    try {
      const candidate = await runtime.current.prepare(
        {
          pluginId: record.id,
          generation: record.generation,
          version: record.version,
        },
        await definition(app.source),
        bridge.services as unknown as Parameters<AppRuntime["prepare"]>[2],
        record.manifest.contributions ?? [],
        (record.config ?? {}) as Record<string, sharedSdk.Json>,
      );
      candidate.scope.add(bridge.dispose);
      return candidate;
    } catch (err) {
      await bridge.dispose();
      throw err;
    }
  }

  useEffect(() => {
    if (workbench.phase !== "online" || !runtime.current) {
      return;
    }
    for (const loaded of runtime.current.snapshot()) {
      if (
        !(workbench.plugins ?? []).some(
          (plugin) => plugin.id === loaded.identity.pluginId && plugin.enabled,
        )
      ) {
        void runtime.current.unload(loaded.identity.pluginId);
      }
    }
    for (const record of workbench.plugins ?? []) {
      if (
        !record.enabled ||
        failed.current.has(`${record.id}:${record.generation}`) ||
        busy.current.has(record.id) ||
        runtime.current
          .snapshot()
          .some(
            (app) =>
              app.identity.pluginId === record.id &&
              app.identity.generation === record.generation,
          ) ||
        !record.manifest.entrypoints?.app
      ) {
        continue;
      }
      busy.current.add(record.id);
      void latest.current
        .call<{ source: string }>(`/plugins/${record.id}/app`)
        .then((app) => prepare(record, app))
        .then((candidate) => {
          if (candidate) {
            if (mounted.current) {
              runtime.current?.publish(candidate);
            } else {
              void candidate.scope.dispose();
            }
          }
        })
        .catch((err) => {
          failed.current.add(`${record.id}:${record.generation}`);
          setError(
            `${record.name ?? record.id}：${err instanceof Error ? err.message : String(err)}`,
          );
        })
        .finally(() => busy.current.delete(record.id));
    }
  }, [workbench.plugins, workbench.phase]);

  async function install(body: Parameters<PluginsController["install"]>[0]) {
    setError("");
    const result = (await latest.current.managePlugin(
      "prepare",
      body as JsonValue & { id?: string },
    )) as {
      plugin: PluginRecord;
      app?: { source: string } | null;
      ticket: string;
    };
    busy.current.add(result.plugin.id);
    let candidate: AppRegistration | null = null;
    try {
      candidate = await prepare(result.plugin, result.app);
      await latest.current.managePlugin("commit", {
        ticket: result.ticket,
      } as JsonValue & { id?: string });
      if (candidate) {
        runtime.current?.publish(candidate);
      }
    } catch (err) {
      if (candidate) {
        await candidate.scope.dispose();
      }
      await latest.current
        .managePlugin("discard", { ticket: result.ticket } as JsonValue & {
          id?: string;
        })
        .catch(() => {});
      throw err;
    } finally {
      busy.current.delete(result.plugin.id);
    }
  }

  return {
    registrations,
    records: workbench.plugins ?? [],
    error,
    install,
    async disable(id: string) {
      await latest.current.managePlugin("disable", { id });
      await runtime.current?.unload(id);
    },
  };
}

class PluginBoundary extends React.Component<
  { children: React.ReactNode },
  { error: string | null }
> {
  override state: { error: string | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: String(error) };
  }

  override render() {
    return this.state.error ? (
      <p role="alert">插件界面失败：{this.state.error}</p>
    ) : (
      this.props.children
    );
  }
}

export function PluginManager({
  workbench,
  plugins,
}: {
  workbench: WorkbenchLike;
  plugins: PluginsController;
}) {
  const [path, setPath] = useState("");
  const [inspection, setInspection] = useState<
    LocalInspectionManifest | PluginRecord["manifest"] | null
  >(null);
  const [trusted, setTrusted] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [config, setConfig] = useState("{}");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<unknown>(undefined);
  const installTrigger = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<"installed" | "discover" | "local">(
    "installed",
  );
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<
    "all" | "enabled" | "disabled"
  >("all");
  const [packageSource, setPackageSource] =
    useState<PluginRecord["source"]>(null);
  const [selectedPlugin, setSelectedPlugin] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const records = (workbench.plugins ?? []).filter(
    (plugin) =>
      (stateFilter === "all" ||
        (stateFilter === "enabled") === Boolean(plugin.enabled)) &&
      `${plugin.name ?? ""} ${plugin.id}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const active = records.find((p) => p.id === selectedPlugin) ?? records[0];

  return (
    <section className="desktop-plugin-settings plugin-center">
      <header className="plugin-center-toolbar">
        <nav aria-label="插件视图">
          <button
            aria-current={view === "installed" ? "page" : undefined}
            onClick={() => {
              setView("installed");
            }}
          >
            已安装<span>{workbench.plugins?.length ?? 0}</span>
          </button>
          <button
            aria-current={view === "discover" ? "page" : undefined}
            onClick={() => {
              setView("discover");
            }}
          >
            获取插件
          </button>
        </nav>
        <button
          className="plugin-local-trigger"
          onClick={() => {
            setView("local");
            setPackageSource(null);
            setInspection(null);
            setPath("");
            setTrusted(false);
          }}
        >
          <FolderOpen size={14} />
          从本地安装
        </button>
      </header>
      {view === "discover" && (
        <RemotePluginInstall
          workbench={workbench}
          plugins={plugins}
          source={
            workbench.plugins?.find((p) => p.id === selectedPlugin)?.source
          }
        />
      )}
      <section className="plugin-local-form max-w-[680px] space-y-5 pb-6" hidden={view !== "local"}>
        <header className="space-y-1.5">
          <Button
            ref={installTrigger}
            variant="ghost"
            size="sm"
            className="mb-2 -ml-2"
            onClick={() => {
              setView("installed");
            }}
          >
            <ArrowLeft size={14} />
            返回已安装
          </Button>
          <h2 className="m-0 text-[18px] font-semibold text-[var(--fg)]">
            安装与配置
          </h2>
          <p className="m-0 text-[12.5px] text-[var(--ink-secondary)]">
            选择插件包目录，检查所需权限后启用。
          </p>
        </header>
        <LocalPluginInstall
          path={path}
          inspection={inspection}
          busy={busy}
          workspaces={workbench.workspaces ?? []}
          selected={selected}
          config={config}
          trusted={trusted}
          onPath={(value) => {
            setPackageSource(null);
            setPath(value);
            setInspection(null);
            setTrusted(false);
          }}
          onSelected={(value) => {
            setSelected(value);
            setTrusted(false);
          }}
          onConfig={(value) => {
            setConfig(value);
            setTrusted(false);
          }}
          onTrusted={setTrusted}
          onChoose={() =>
            void run(async () => {
              const next = await chooseWorkspace();
              if (next) {
                setPackageSource(null);
                setPath(next);
                setInspection(null);
                setTrusted(false);
              }
            })
          }
          onInspect={() =>
            void run(async () => {
              const inspected = (await workbench.managePlugin("inspect", {
                path,
              })) as LocalInspectionManifest;
              setInspection(inspected);
              if (
                config.trim() === "{}" &&
                inspected.configSchema?.properties
              ) {
                const defaults = buildDefaultPluginConfig(
                  inspected.configSchema,
                );
                if (Object.keys(defaults).length > 0) {
                  setConfig(JSON.stringify(defaults, null, 2));
                }
              }
              setTrusted(false);
            })
          }
          onExample={() => {
            setPackageSource(null);
            setPath(workbench.examplePluginPath ?? "");
            setInspection(null);
            setTrusted(false);
          }}
          onInstall={() =>
            void run(() =>
              plugins
                .install({
                  path,
                  source: packageSource,
                  trusted,
                  workspaces: selected,
                  config: JSON.parse(config) as Record<string, unknown>,
                  expectedManifest: inspection,
                })
                .then(() => {
                  setView("installed");
                  if (inspection && "id" in inspection && inspection.id) {
                    setSelectedPlugin(inspection.id);
                  }
                  requestAnimationFrame(() =>
                    listRef.current
                      ?.querySelector<HTMLElement>("button.selected")
                      ?.focus(),
                  );
                }),
            )
          }
        />
      </section>
      {view === "installed" && (
        <Card className="plugin-installed-layout overflow-hidden">
          <aside className="plugin-installed-list flex flex-col gap-3" aria-label="已安装插件">
            <div className="relative">
              <Search
                size={14}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted)]"
              />
              <Input
                aria-label="搜索已安装插件"
                placeholder="搜索插件…"
                value={query}
                className="h-8 pl-8 text-[12px]"
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className="flex items-center justify-between gap-2 px-1 text-[11.5px] text-[var(--muted)]">
              <span>{records.length} 个插件</span>
              <Select
                aria-label="筛选插件状态"
                value={stateFilter}
                className="h-7 border-transparent bg-transparent py-0 pl-2 pr-6 text-[11.5px]"
                onChange={(event) =>
                  setStateFilter(
                    event.target.value as "all" | "enabled" | "disabled",
                  )
                }
              >
                <option value="all">全部状态</option>
                <option value="enabled">已启用</option>
                <option value="disabled">已停用</option>
              </Select>
            </div>
            <div className="plugin-installed-items" ref={listRef}>
              {records.map((plugin) => (
                <button
                  key={plugin.id}
                  aria-pressed={active?.id === plugin.id}
                  className={active?.id === plugin.id ? "selected" : ""}
                  onClick={() => setSelectedPlugin(plugin.id)}
                >
                  <span className="plugin-list-icon">
                    <PluginIcon plugin={plugin} size={19} />
                  </span>
                  <span>
                    <strong>{plugin.name ?? plugin.id}</strong>
                    <small>
                      v{plugin.version} ·{" "}
                      {plugin.enabled ? "已启用" : "已停用"}
                    </small>
                  </span>
                  <i className={plugin.enabled ? "enabled" : ""} />
                </button>
              ))}
            </div>
            {!records.length && (
              <p className="plugin-list-empty">
                {query || stateFilter !== "all"
                  ? "未找到匹配的插件"
                  : "暂无插件"}
              </p>
            )}
          </aside>
          <div className="plugin-installed-detail">
            {active &&
              [active].map((plugin) => (
                <PluginDetails
                  key={plugin.id}
                  plugin={plugin}
                  workspaces={workbench.workspaces ?? []}
                  busy={busy}
                  onEnable={() =>
                    void run(() =>
                      plugins.install({
                        path: plugin.path,
                        trusted: true,
                        workspaces: plugin.workspaces ?? [],
                        config: plugin.config ?? {},
                        source: plugin.source,
                        expectedManifest: plugin.manifest,
                      }),
                    )
                  }
                  onDisable={() => void run(() => plugins.disable(plugin.id))}
                  onUpdate={() => {
                    setSelectedPlugin(plugin.id);
                    setView("discover");
                  }}
                  onConfigure={() => {
                    setView("local");
                    setPackageSource(plugin.source ?? null);
                    setPath(plugin.path);
                    setInspection(plugin.manifest);
                    setSelected(plugin.workspaces ?? []);
                    setConfig(JSON.stringify(plugin.config ?? {}, null, 2));
                    setTrusted(false);
                  }}
                  onInvoke={(item) =>
                    void run(async () =>
                      setResult(
                        await workbench.invokePlugin(plugin.id, {
                          handler: item.binding?.handler,
                          input: { path: "." },
                          workspaceId: plugin.workspaces?.[0],
                        }),
                      ),
                    )
                  }
                >
                  {plugins.registrations
                    .filter((app) => app.identity.pluginId === plugin.id)
                    .map((app) => (
                      <PluginBoundary
                        key={`${app.identity.pluginId}:${app.identity.generation}`}
                      >
                        <section className="plugin-app-settings space-y-2 border-t border-[var(--line)] pt-4">
                          {[...app.panels]
                            .filter(
                              ([id]) =>
                                !(
                                  plugin.manifest.contributions ?? []
                                ).some(
                                  (c) =>
                                    c.id === id &&
                                    c.surface === "workspace.tool",
                                ),
                            )
                            .concat([...app.settings])
                            .map(([id, Component]) => (
                              <React.Fragment key={id}>
                                {Component({
                                  panelId: id,
                                  theme:
                                    document.documentElement.dataset.theme ===
                                    "light"
                                      ? "light"
                                      : "dark",
                                  workspaceId: (workbench.plugins ?? [])
                                    .find(
                                      (p) =>
                                        p.id === app.identity.pluginId &&
                                        p.enabled,
                                    )
                                    ?.workspaces?.find((wsId) =>
                                      (workbench.workspaces ?? []).some(
                                        (workspace) => workspace.id === wsId,
                                      ),
                                    ),
                                }) as React.ReactNode}
                              </React.Fragment>
                            ))}
                          {[...app.commands].map(([id, command]) => (
                            <Button
                              key={id}
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                void run(() => Promise.resolve(command()))
                              }
                            >
                              {id}
                            </Button>
                          ))}
                        </section>
                      </PluginBoundary>
                    ))}
                </PluginDetails>
              ))}
            {!active && (
              <div className="flex min-h-[400px] flex-col items-center justify-center gap-3 text-center text-[var(--muted)]">
                <Plug size={30} strokeWidth={1.5} />
                <h2 className="m-0 mt-1 text-[16px] font-semibold text-[var(--fg)]">
                  {query || stateFilter !== "all"
                    ? "没有匹配的插件"
                    : "为工作台添加功能"}
                </h2>
                <p className="m-0 max-w-[32ch] text-[12.5px] leading-relaxed">
                  {query || stateFilter !== "all"
                    ? "换个名称或筛选条件试试。"
                    : "文件、终端、网页等功能都可以独立安装和更新。"}
                </p>
                {!query && stateFilter === "all" && (
                  <Button size="sm" onClick={() => setView("discover")}>
                    <Download size={14} />
                    获取插件
                  </Button>
                )}
              </div>
            )}
          </div>
        </Card>
      )}
      {Boolean(workbench.operations?.length) && (
        <details className="plugin-diagnostics mt-5 border-t border-[var(--line)] pt-4 text-[12px] text-[var(--muted)]" aria-label="最近后台操作">
          <summary className="cursor-pointer select-none hover:text-[var(--fg)]">
            最近后台操作 · {workbench.operations?.length}
          </summary>
          <p className="my-2 leading-relaxed">
            操作在主机执行。关闭页面不会取消已受理的操作；中断记录不会自动重试。
          </p>
          <Card className="divide-y divide-[var(--line)]">
            {workbench.operations?.map((operation) => {
              const display = operationPresentation(operation);
              return (
                <div
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-[12.5px]"
                  key={operation.id}
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <strong className="block font-medium text-[var(--fg)]">
                      {display.title}
                    </strong>
                    <p className="m-0 text-[11.5px] text-[var(--muted)]">
                      {display.plugin} · {display.time}
                    </p>
                  </div>
                  <Badge variant="outline">{display.state}</Badge>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy || workbench.phase !== "online"}
                    aria-label={`查看操作结果 ${operation.id}`}
                    onClick={() =>
                      void run(async () => {
                        const record = await workbench.read<{
                          state: string;
                          result?: unknown;
                          error?: Record<string, unknown>;
                        }>(`/operations/${operation.id}`);
                        setResult(
                          record.state === "succeeded"
                            ? record.result
                            : { state: record.state, ...record.error },
                        );
                      })
                    }
                  >
                    查看结果
                  </Button>
                </div>
              );
            })}
          </Card>
        </details>
      )}
      {Boolean(workbench.pluginEvents?.length) && (
        <details className="plugin-diagnostics mt-4 text-[12px] text-[var(--muted)]">
          <summary className="cursor-pointer">插件执行进度</summary>
          {workbench.pluginEvents?.map((event, index) => (
            <pre className="desktop-diagnostic mt-2 rounded-lg border border-[var(--line)] bg-[var(--bg)] p-3 font-mono text-[11.5px]" key={index}>
              {event.pluginId} · {event.text}
            </pre>
          ))}
        </details>
      )}
      {result !== undefined && (
        <details className="plugin-diagnostics mt-4 text-[12px] text-[var(--muted)]" open>
          <summary className="cursor-pointer">操作结果</summary>
          <pre className="desktop-diagnostic mt-2 rounded-lg border border-[var(--line)] bg-[var(--bg)] p-3 font-mono text-[11.5px]">
            {JSON.stringify(result, null, 2)}
          </pre>
        </details>
      )}
      {(error || plugins.error) && (
        <Alert variant="destructive" role="alert" className="mt-4">
          {error || plugins.error}
        </Alert>
      )}
    </section>
  );
}
