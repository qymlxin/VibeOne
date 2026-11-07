import React,{createContext,useContext,useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {SettingsSwitch} from './SettingsRows.jsx';
import {AppRuntime} from '@vibeone/plugin-sdk/app';
const definitions=[
 {id:'files',name:'文件浏览',title:'文件',icon:'folder',description:'浏览目录与预览代码',load:()=>import('./builtin-plugins/files.jsx')},
 {id:'changes',name:'变更审阅',title:'变更',icon:'changes',description:'文件变更树与真实 Git 差异',load:()=>import('./builtin-plugins/changes.jsx')},
 {id:'terminal',name:'交互终端',title:'终端',icon:'terminal',description:'运行命令与脚本，独立 Shell 会话',load:()=>import('./builtin-plugins/terminal.jsx')},
 {id:'browser',name:'网页预览',title:'网页',icon:'browser',description:'在工作台浏览网页与本地服务',load:()=>import('./builtin-plugins/browser.jsx')},
];
const Context=createContext({tools:[],builtins:[],error:'',toggle:()=>{}});
export const useWorkspaceExtensions=()=>useContext(Context);
const emptyServices={workbench:{snapshot:()=>({}),subscribe:()=>()=>{}},invokeWorker:async()=>{throw Error('此内置界面不使用Worker');}};
export function WorkspaceExtensions({plugins,children}){
 const[disabled,setDisabled]=useState(()=>{try{const ids=JSON.parse(localStorage.getItem('vibeone-disabled-ui-plugins')??'[]');return Array.isArray(ids)?ids.filter(id=>definitions.some(d=>d.id===id)):[];}catch{return [];}}),[error,setError]=useState('');
 const[runtime]=useState(()=>new AppRuntime(error=>setError(String(error)))),revision=useRef(0);
 const registrations=useSyncExternalStore(runtime.subscribe,runtime.snapshot);
 useEffect(()=>{let stale=false;const generation=++revision.current;
  for(const item of definitions){
   if(disabled.includes(item.id)){void runtime.unload('builtin.'+item.id);continue;}
   if(runtime.snapshot().some(r=>r.identity.pluginId==='builtin.'+item.id))continue;
   void item.load().then(module=>runtime.prepare({pluginId:'builtin.'+item.id,version:'0.1.0',generation},module.default,emptyServices,[{id:item.id,kind:'app.panel'}])).then(candidate=>{if(stale)void candidate.scope.dispose();else runtime.publish(candidate);}).catch(error=>{if(!stale)setError(item.name+'：'+error.message);});
  }
  return()=>{stale=true;};
 },[disabled,runtime]);
 useEffect(()=>()=>{for(const record of runtime.snapshot())void runtime.unload(record.identity.pluginId);},[runtime]);
 const tools=definitions.filter(item=>!disabled.includes(item.id)).flatMap(item=>{const component=registrations.find(r=>r.identity.pluginId==='builtin.'+item.id)?.panels.get(item.id);return component?[{...item,Component:component,builtin:true}]:[];});
 for(const app of plugins?.registrations??[]){const record=plugins.records?.find(record=>record.id===app.identity.pluginId&&record.enabled&&record.generation===app.identity.generation);for(const contribution of record?.manifest.contributions??[]){if(contribution.kind!=='app.panel'||contribution.surface!=='workspace.tool')continue;const Component=app.panels.get(contribution.id);if(Component)tools.push({id:`plugin:${record.id}:${contribution.id}`,title:String(contribution.title??contribution.id),description:String(contribution.description??record.name??record.id),icon:String(contribution.icon??'extension'),Component,builtin:false});}}
 function toggle(id){setError('');setDisabled(current=>{const next=current.includes(id)?current.filter(value=>value!==id):[...current,id];try{localStorage.setItem('vibeone-disabled-ui-plugins',JSON.stringify(next));}catch{setError('本次开关已生效，但无法保存到本设备');}return next;});}
 return <Context.Provider value={{tools,builtins:definitions.map(item=>({...item,enabled:!disabled.includes(item.id),active:tools.some(tool=>tool.id===item.id)})),toggle,error}}>{children}</Context.Provider>;
}
export function WorkspaceTool({kind,...props}){const {tools,builtins,error}=useWorkspaceExtensions(),tool=tools.find(item=>item.id===kind);if(!tool)return <div className="context-tool-failure" role="status"><h2>{error?'工具加载失败':builtins.find(item=>item.id===kind)?.enabled?'工具正在加载':'工具插件未启用'}</h2><p>可在设置 → 插件中管理工作区工具。</p></div>;const Component=tool.Component;return tool.builtin?<Component {...props}/>:<Component sessionId={props.session?.id} workspaceId={props.session?.workspaceId??props.workbench?.workspaces?.find(workspace=>workspace.path===props.session?.workspace)?.id}/>;}
export function BuiltinPluginSettings(){const{builtins,toggle,error}=useWorkspaceExtensions();return <section className="settings-group desktop-settings-group"><h2>内置工作区插件</h2><p>开关保存在本设备。停用终端会结束该面板的Shell，后台Agent任务继续执行。</p><div className="settings-rows">{builtins.map(item=><div className="settings-row desktop-settings-row" key={item.id}><div><strong>{item.name}</strong><p>{item.description}</p></div><SettingsSwitch label={`启用${item.name}插件`} checked={item.enabled} onChange={()=>toggle(item.id)}/></div>)}</div>{error&&<p role="alert">{error}</p>}</section>;}
