import React, {
  useEffect,
  useRef,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import {Plug,Search,ArrowLeft,Download,FolderOpen} from 'lucide-react';
import {PluginIcon} from './plugin-presentation.jsx';
import './plugin-center.css';
import {LocalPluginInstall} from './LocalPluginInstall.jsx';
import {invoke,streamChannel} from './native.js';
import {pluginServices} from "./plugin-services.js";
import {RemotePluginInstall} from './RemotePluginInstall.jsx';
import {PluginDetails} from './PluginDetails.jsx';
import {operationPresentation} from './plugin-operations.js';
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
  async function prepare(record, app) {
    if (!app) return null;
    const bridge=pluginServices(record,latest,snapshotRef,listeners,{invoke,streamChannel,available:!!window.vibeoneDesktop});
    try {
      const candidate=await runtime.current.prepare({pluginId:record.id,generation:record.generation,version:record.version},await definition(app.source),bridge.services,record.manifest.contributions??[],record.config??{});
      candidate.scope.add(bridge.dispose);
      return candidate;
    } catch(error){await bridge.dispose();throw error;}
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
    const result = await latest.current.managePlugin("prepare", body);
    busy.current.add(result.plugin.id);
    let candidate;
    try {
      candidate = await prepare(result.plugin, result.app);
      await latest.current.managePlugin("commit", { ticket: result.ticket });
      if (candidate) runtime.current.publish(candidate);
    } catch (error) {
      if (candidate) await candidate.scope.dispose();
      await latest.current
        .managePlugin("discard", { ticket: result.ticket })
        .catch(() => {});
      throw error;
    } finally {
      busy.current.delete(result.plugin.id);
    }
  }
  return {
    registrations,
    records:workbench.plugins??[],
    error,
    install,
    async disable(id) {
      await latest.current.managePlugin("disable", { id });
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
  const installTrigger=useRef(null),listRef=useRef(null);
  const [view,setView]=useState('installed'),[query,setQuery]=useState(''),[stateFilter,setStateFilter]=useState('all');
  const [packageSource,setPackageSource]=useState(null);
  const [selectedPlugin,setSelectedPlugin]=useState(null);
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
  const records=(workbench.plugins??[]).filter(plugin=>(stateFilter==='all'||(stateFilter==='enabled')===!!plugin.enabled)&&`${plugin.name} ${plugin.id}`.toLowerCase().includes(query.toLowerCase()));
  const active=records.find(p=>p.id===selectedPlugin)??records[0];
  return (
    <section className="desktop-plugin-settings plugin-center">
      <header className="plugin-center-toolbar"><nav aria-label="插件视图"><button aria-current={view==='installed'?'page':undefined} onClick={()=>{setView('installed');}}>已安装<span>{workbench.plugins?.length??0}</span></button><button aria-current={view==='discover'?'page':undefined} onClick={()=>{setView('discover');}}>获取插件</button></nav><button className="plugin-local-trigger" onClick={()=>{setView('local');setPackageSource(null);setInspection(null);setPath('');setTrusted(false);}}><FolderOpen size={14}/>从本地安装</button></header>
      {view==='discover'&&<RemotePluginInstall workbench={workbench} plugins={plugins} source={workbench.plugins?.find(p=>p.id===selectedPlugin)?.source}/>}


      <section className="plugin-local-form" hidden={view!=='local'}><header><button ref={installTrigger} onClick={()=>{setView('installed');}}><ArrowLeft size={14}/>返回已安装</button><h2>安装与配置</h2><p>选择插件包目录，检查所需权限后启用。</p></header>
      <LocalPluginInstall path={path} inspection={inspection} busy={busy} workspaces={workbench.workspaces??[]} selected={selected} config={config} trusted={trusted}
        onPath={value=>{setPackageSource(null);setPath(value);setInspection(null);setTrusted(false);}}
        onSelected={value=>{setSelected(value);setTrusted(false);}} onConfig={value=>{setConfig(value);setTrusted(false);}} onTrusted={setTrusted}
        onChoose={()=>void run(async()=>{const next=await chooseWorkspace();if(next){setPackageSource(null);setPath(next);setInspection(null);setTrusted(false);}})}
        onInspect={()=>void run(async()=>{setInspection(await workbench.managePlugin('inspect',{path}));setTrusted(false);})}
        onExample={()=>{setPackageSource(null);setPath(workbench.examplePluginPath);setInspection(null);setTrusted(false);}}
        onInstall={()=>void run(()=>plugins.install({path,source:packageSource,trusted,workspaces:selected,config:JSON.parse(config),expectedManifest:inspection}).then(()=>{setView('installed');setSelectedPlugin(inspection.id);requestAnimationFrame(()=>listRef.current?.querySelector('button.selected')?.focus());}))}/>
      </section>
      {view==='installed'&&<div className="plugin-installed-layout"><aside className="plugin-installed-list" aria-label="已安装插件"><label className="plugin-list-search"><Search size={14}/><input aria-label="搜索已安装插件" placeholder="搜索插件…" value={query} onChange={event=>setQuery(event.target.value)}/></label><div className="plugin-list-filter"><span>{records.length} 个插件</span><select aria-label="筛选插件状态" value={stateFilter} onChange={event=>setStateFilter(event.target.value)}><option value="all">全部状态</option><option value="enabled">已启用</option><option value="disabled">已停用</option></select></div><div className="plugin-installed-items" ref={listRef}>{records.map(plugin=><button key={plugin.id} aria-pressed={active?.id===plugin.id} className={active?.id===plugin.id?'selected':''} onClick={()=>setSelectedPlugin(plugin.id)}><span className="plugin-list-icon"><PluginIcon plugin={plugin} size={19}/></span><span><strong>{plugin.name??plugin.id}</strong><small>v{plugin.version} · {plugin.enabled?'已启用':'已停用'}</small></span><i className={plugin.enabled?'enabled':''}/></button>)}</div>{!records.length&&<p className="plugin-list-empty">{query||stateFilter!=='all'?'未找到匹配的插件':'暂无插件'}</p>}</aside><div className="plugin-installed-detail">
      {active&&[active].map((plugin) => (
        <PluginDetails key={plugin.id} plugin={plugin} workspaces={workbench.workspaces??[]} busy={busy}
          onEnable={()=>void run(()=>plugins.install({path:plugin.path,trusted:true,workspaces:plugin.workspaces,config:plugin.config,source:plugin.source,expectedManifest:plugin.manifest}))}
          onDisable={()=>void run(()=>plugins.disable(plugin.id))}
          onUpdate={()=>{setSelectedPlugin(plugin.id);setView('discover');}}
          onConfigure={()=>{setView('local');setPackageSource(plugin.source);setPath(plugin.path);setInspection(plugin.manifest);setSelected(plugin.workspaces);setConfig(JSON.stringify(plugin.config,null,2));setTrusted(false);}}
          onInvoke={item=>void run(async()=>setResult(await workbench.invokePlugin(plugin.id,{handler:item.binding.handler,input:{path:'.'},workspaceId:plugin.workspaces[0]})))}>      {plugins.registrations.filter(app=>app.identity.pluginId===plugin.id).map((app) => (
        <PluginBoundary
          key={`${app.identity.pluginId}:${app.identity.generation}`}
        >
          <section className="plugin-app-settings">
            {[...app.panels].filter(([id])=>!plugin.manifest.contributions.some(c=>c.id===id&&c.surface==='workspace.tool')).concat([...app.settings]).map(([id, Component]) => (
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
</PluginDetails>

      ))}
      {!active&&<div className="plugin-center-empty"><Plug size={30} strokeWidth={1.5}/><h2>{query||stateFilter!=='all'?'没有匹配的插件':'为工作台添加功能'}</h2><p>{query||stateFilter!=='all'?'换个名称或筛选条件试试。':'文件、终端、网页等功能都可以独立安装和更新。'}</p>{!query&&stateFilter==='all'&&<button className="plugin-primary" onClick={()=>setView('discover')}><Download size={14}/>获取插件</button>}</div>}</div></div>}
      {!!workbench.operations?.length&&<details className="plugin-diagnostics" aria-label="最近后台操作"><summary>最近后台操作 · {workbench.operations.length}</summary><p>操作在主机执行。关闭页面不会取消已受理的操作；中断记录不会自动重试。</p>{workbench.operations.map(operation=>{const display=operationPresentation(operation);return <div className="desktop-settings-row" key={operation.id}><div><strong>{display.title}</strong><p>{display.plugin} · {display.time}</p></div><span>{display.state}</span><button type="button" disabled={busy||workbench.phase!=='online'} aria-label={`查看操作结果 ${operation.id}`} onClick={()=>void run(async()=>{const record=await workbench.read(`/operations/${operation.id}`);setResult(record.state==='succeeded'?record.result:{state:record.state,...record.error});})}>查看结果</button></div>;})}</details>}
      {!!workbench.pluginEvents?.length && (
        <details className="plugin-diagnostics">
          <summary>插件执行进度</summary>
          {workbench.pluginEvents.map((event, index) => (
            <pre className="desktop-diagnostic" key={index}>
              {event.pluginId} · {event.text}
            </pre>
          ))}
        </details>
      )}
      {result !== undefined && (
        <details className="plugin-diagnostics" open><summary>操作结果</summary><pre className="desktop-diagnostic">{JSON.stringify(result,null,2)}</pre></details>
      )}
      {(error || plugins.error) && <p role="alert">{error || plugins.error}</p>}
    </section>
  );
}
