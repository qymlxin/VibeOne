import React, {
  useEffect,
  useRef,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import * as jsx from "react/jsx-runtime";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import * as sharedSdk from "@vibeone/plugin-sdk";
import { AppRuntime, defineApp } from "@vibeone/plugin-sdk/app";
import { chooseWorkspace } from "./api.js";

let sharedInstalled = false;
function sharedModules() {
  if (sharedInstalled) return;
  sharedInstalled = true;
  window.__vibeoneReact = React;
  window.__vibeoneJsx = jsx;
  window.__vibeoneSdk = { ...sharedSdk, defineApp };
  window.__vibeoneReactDOM = ReactDOM;
  window.__vibeoneReactDOMClient = ReactDOMClient;
  const module = (global, names, defaultExport = false) =>
    URL.createObjectURL(
      new Blob(
        [
          `${defaultExport ? `export default window.${global};` : ""}${names.map((name) => `export const ${name}=window.${global}.${name};`).join("\n")}`,
        ],
        { type: "text/javascript" },
      ),
    );
  const imports = {
    react: module(
      "__vibeoneReact",
      Object.keys(React).filter(
        (name) => name !== "default" && /^[A-Za-z_$][\w$]*$/.test(name),
      ),
      true,
    ),
    "react-dom": module(
      "__vibeoneReactDOM",
      Object.keys(ReactDOM).filter(
        (name) => name !== "default" && /^[A-Za-z_$][\w$]*$/.test(name),
      ),
      true,
    ),
    "react-dom/client": module(
      "__vibeoneReactDOMClient",
      Object.keys(ReactDOMClient).filter(
        (name) => name !== "default" && /^[A-Za-z_$][\w$]*$/.test(name),
      ),
    ),
    "@vibeone/plugin-sdk": module(
      "__vibeoneSdk",
      Object.keys({ ...sharedSdk, defineApp }),
    ),
    "react/jsx-runtime": module("__vibeoneJsx", ["jsx", "jsxs", "Fragment"]),
    "@vibeone/plugin-sdk/app": module("__vibeoneSdk", ["defineApp"]),
  };
  const map = document.createElement("script");
  map.type = "importmap";
  const nonce = document.querySelector("script[nonce]")?.nonce;
  if (nonce) map.nonce = nonce;
  map.textContent = JSON.stringify({ imports });
  document.head.append(map);
}
async function definition(source) {
  sharedModules();
  const url = URL.createObjectURL(
    new Blob([source], { type: "text/javascript" }),
  );
  try {
    return (await import(/* @vite-ignore */ url)).default;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function usePlugins(workbench) {
  const [error, setError] = useState("");
  const runtime = useRef(null);
  if (!runtime.current)
    runtime.current = new AppRuntime((error) => setError(String(error)));
  const snapshot = useMemo(
    () => ({
      sessions: workbench.sessions,
      workspaces: workbench.workspaces ?? [],
      pluginEvents: workbench.pluginEvents ?? [],
    }),
    [workbench.sessions, workbench.workspaces, workbench.pluginEvents],
  );
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const latest = useRef(workbench);
  latest.current = workbench;
  const listeners = useRef(new Set());
  const busy = useRef(new Set());
  const failed = useRef(new Set());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const app of runtime.current.snapshot())
        void runtime.current.unload(app.identity.pluginId);
    };
  }, []);
  const registrations = useSyncExternalStore(
    runtime.current.subscribe,
    runtime.current.snapshot,
  );
  useEffect(() => {
    for (const listener of listeners.current) listener();
    runtime.current.emit("workbench.changed", workbench.sessions);
  }, [snapshot]);
  function services(id, generation) {
    return {
      workbench: {
        snapshot: () => snapshotRef.current,
        subscribe: (listener) => {
          const subscription = () => listener();
          listeners.current.add(subscription);
          return () => listeners.current.delete(subscription);
        },
      },
      invokeWorker: (handler, input, workspaceId) =>
        latest.current.invokePlugin(id, {
          handler,
          input,
          workspaceId,
          generation,
        }),
    };
  }
  async function prepare(record, app) {
    if (!app) return null;
    return runtime.current.prepare(
      {
        pluginId: record.id,
        generation: record.generation,
        version: record.version,
      },
      await definition(app.source),
      services(record.id, record.generation),
      record.manifest.contributions ?? [],
      record.config ?? {},
    );
  }
  useEffect(() => {
    if (workbench.phase !== "online") return;
    for (const loaded of runtime.current.snapshot())
      if (
        !(workbench.plugins ?? []).some(
          (plugin) => plugin.id === loaded.identity.pluginId && plugin.enabled,
        )
      )
        void runtime.current.unload(loaded.identity.pluginId);
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
        !record.manifest.entrypoints.app
      )
        continue;
      busy.current.add(record.id);
      void latest.current
        .call(`/plugins/${record.id}/app`)
        .then((app) => prepare(record, app))
        .then((candidate) => {
          if (candidate) {
            if (mounted.current) runtime.current.publish(candidate);
            else void candidate.scope.dispose();
          }
        })
        .catch((error) => {
          failed.current.add(`${record.id}:${record.generation}`);
          setError(`${record.name ?? record.id}：${error.message}`);
        })
        .finally(() => busy.current.delete(record.id));
    }
  }, [workbench.plugins, workbench.phase]);
  async function install(body) {
    setError("");
    const result = await latest.current.call("/plugins/prepare", body);
    busy.current.add(result.plugin.id);
    let candidate;
    try {
      candidate = await prepare(result.plugin, result.app);
      await latest.current.call("/plugins/commit", { ticket: result.ticket });
      if (candidate) runtime.current.publish(candidate);
    } catch (error) {
      if (candidate) await candidate.scope.dispose();
      await latest.current
        .call("/plugins/discard", { ticket: result.ticket })
        .catch(() => {});
      throw error;
    } finally {
      busy.current.delete(result.plugin.id);
    }
  }
  return {
    registrations,
    error,
    install,
    async disable(id) {
      await latest.current.call(`/plugins/${id}/disable`, {});
      await runtime.current.unload(id);
    },
  };
}

class PluginBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error: String(error) };
  }
  render() {
    return this.state.error ? (
      <p role="alert">插件界面失败：{this.state.error}</p>
    ) : (
      this.props.children
    );
  }
}
export function PluginManager({ workbench, plugins }) {
  const [path, setPath] = useState(""),
    [inspection, setInspection] = useState(null),
    [trusted, setTrusted] = useState(false),
    [selected, setSelected] = useState([]),
    [config, setConfig] = useState("{}"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState(undefined);
  const [installOpen,setInstallOpen]=useState(false),[selectedPlugin,setSelectedPlugin]=useState(null);
  async function run(action) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (error) {
      setError(error.message ?? String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h2>本地插件</h2>
      <p>
        JS 插件作为可信本机代码运行。支持安装、更新、停用、动态面板与后台命令。
      </p>
      <details className="desktop-plugin-install" open={installOpen} onToggle={event=>setInstallOpen(event.currentTarget.open)}><summary>安装 / 更新本地插件</summary>
      <button
        onClick={() => {
          setPath(workbench.examplePluginPath);
          setInspection(null);
          setTrusted(false);
        }}
      >
        选择内置示例插件
      </button>
      <div className="desktop-management-form">
        <label>
          插件目录
          <input
            value={path}
            onChange={(event) => {
              setPath(event.target.value);
              setInspection(null);
              setTrusted(false);
            }}
          />
        </label>
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const next = await chooseWorkspace();
              if (next) {
                setPath(next);
                setInspection(null);
                setTrusted(false);
              }
            })
          }
        >
          选择插件目录
        </button>
        <button
          disabled={busy || !path}
          onClick={() =>
            void run(async () => {
              setInspection(await workbench.call("/plugins/inspect", { path }));
              setTrusted(false);
            })
          }
        >
          检查插件
        </button>
        {inspection && (
          <>
            <p>
              {inspection.name ?? inspection.id} · {inspection.version}
            </p>
            <p>
              声明权限：{(inspection.hostRequirements ?? []).join("、") || "无"}
            </p>
            <p>
              扩展点：
              {(inspection.contributions ?? [])
                .map((item) => item.kind)
                .join("、")}
            </p>
            {(workbench.workspaces ?? []).map((workspace) => (
              <label key={workspace.id}>
                <span>
                  <input
                    type="checkbox"
                    checked={selected.includes(workspace.id)}
                    onChange={(event) =>
                      setSelected((current) =>
                        event.target.checked
                          ? [...current, workspace.id]
                          : current.filter((id) => id !== workspace.id),
                      )
                    }
                  />
                  允许访问 {workspace.name}
                </span>
              </label>
            ))}
            <label>
              插件配置（JSON）
              <textarea
                value={config}
                onChange={(event) => setConfig(event.target.value)}
              />
            </label>
            <label>
              <span>
                <input
                  type="checkbox"
                  checked={trusted}
                  onChange={(event) => setTrusted(event.target.checked)}
                />
                信任此本地插件及上述权限
              </span>
            </label>
            <button
              disabled={!trusted || busy}
              onClick={() =>
                void run(() =>
                  plugins.install({
                    path,
                    trusted,
                    workspaces: selected,
                    config: JSON.parse(config),
                    expectedManifest: inspection,
                  }),
                )
              }
            >
              安装 / 更新并启用
            </button>
          </>
        )}
      </div>
      </details>
      <div className="desktop-settings-object-layout"><aside className="desktop-settings-object-list"><header>已安装插件</header>{(workbench.plugins??[]).map(plugin=><button key={plugin.id} className={(selectedPlugin??workbench.plugins?.[0]?.id)===plugin.id?'selected':''} onClick={()=>setSelectedPlugin(plugin.id)}><span><strong>{plugin.name??plugin.id}</strong><small>{plugin.version} · {plugin.enabled?'已启用':'已停用'}</small></span></button>)}{!workbench.plugins?.length&&<p>尚未安装本地插件。</p>}</aside><div className="desktop-settings-object-detail">
      {(workbench.plugins ?? []).filter(plugin=>plugin.id===(selectedPlugin??workbench.plugins?.[0]?.id)).map((plugin) => (
        <article className="desktop-plugin-card" key={plugin.id}>
          <strong>{plugin.name ?? plugin.id}</strong> · {plugin.version} ·{" "}
          {plugin.enabled ? "已启用" : "已停用"}
          <p>
            代次 {plugin.generation} · {(plugin.capabilities ?? []).join("、")}
          </p>
          {plugin.error && <p role="alert">{plugin.error}</p>}
          <button
            disabled={busy || !plugin.enabled}
            onClick={() => void run(() => plugins.disable(plugin.id))}
          >
            停用
          </button>
          <button
            disabled={busy}
            onClick={() => {
              setInstallOpen(true);
              setPath(plugin.path);
              setInspection(plugin.manifest);
              setSelected(plugin.workspaces);
              setConfig(JSON.stringify(plugin.config, null, 2));
              setTrusted(false);
            }}
          >
            重新配置 / 启用
          </button>
          {plugin.enabled &&
            plugin.manifest.contributions
              .filter(
                (item) =>
                  item.kind === "app.command" && item.binding.type === "worker",
              )
              .map((item) => (
                <button
                  key={item.id}
                  disabled={busy}
                  onClick={() =>
                    void run(async () =>
                      setResult(
                        await workbench.invokePlugin(plugin.id, {
                          handler: item.binding.handler,
                          input: { path: "." },
                          workspaceId: plugin.workspaces[0],
                        }),
                      ),
                    )
                  }
                >
                  {item.title ?? item.id}
                </button>
              ))}
        </article>
      ))}
      </div></div>
      {plugins.registrations.map((app) => (
        <PluginBoundary
          key={`${app.identity.pluginId}:${app.identity.generation}`}
        >
          <section>
            <h3>{app.identity.pluginId}</h3>
            {[...app.panels, ...app.settings].map(([id, Component]) => (
              <Component
                key={id}
                workspaceId={(workbench.plugins ?? []).find(plugin=>plugin.id===app.identity.pluginId && plugin.enabled)?.workspaces?.find(id=>(workbench.workspaces ?? []).some(workspace=>workspace.id===id))}
              />
            ))}
            {[...app.commands].map(([id, command]) => (
              <button key={id} onClick={() => void run(command)}>
                {id}
              </button>
            ))}
          </section>
        </PluginBoundary>
      ))}
      {!!workbench.operations?.length&&<details className="desktop-settings-group" aria-label="最近后台操作"><summary>最近后台操作 · {workbench.operations.length}</summary><p>操作在主机执行。关闭页面不会取消已受理的操作；中断记录不会自动重试。</p>{workbench.operations.map(operation=><div className="desktop-settings-row" key={operation.id}><div><strong>{operation.title??operation.handler}</strong><p>{operation.pluginName??operation.pluginId} · {new Date(operation.createdAt).toLocaleString()}</p></div><span>{({accepted:'已受理',running:'执行中',succeeded:'已完成',failed:'失败',interrupted:'已中断'})[operation.state]??'未知状态'}</span><button type="button" disabled={busy||workbench.phase!=='online'} aria-label={`查看操作结果 ${operation.id}`} onClick={()=>void run(async()=>{const record=await workbench.read(`/operations/${operation.id}`);setResult(record.state==='succeeded'?record.result:{state:record.state,...record.error});})}>查看结果</button></div>)}</details>}
      {!!workbench.pluginEvents?.length && (
        <details>
          <summary>插件执行进度</summary>
          {workbench.pluginEvents.map((event, index) => (
            <pre className="desktop-diagnostic" key={index}>
              {event.pluginId} · {event.text}
            </pre>
          ))}
        </details>
      )}
      {result !== undefined && (
        <pre className="desktop-diagnostic">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
      {(error || plugins.error) && <p role="alert">{error || plugins.error}</p>}
    </section>
  );
}
