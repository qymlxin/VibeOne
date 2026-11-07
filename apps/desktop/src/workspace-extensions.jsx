import React,{createContext,useContext} from 'react';
const Context=createContext({tools:[],builtins:[]});
export const useWorkspaceExtensions=()=>useContext(Context);
const aliases=new Map(['files','changes','terminal','browser'].map(id=>[`dev.vibeone.${id}:${id}`,id]));
export function WorkspaceExtensions({plugins,children}){
 const tools=[];
 for(const app of plugins?.registrations??[]){const record=plugins.records?.find(record=>record.id===app.identity.pluginId&&record.enabled&&record.generation===app.identity.generation);for(const contribution of record?.manifest.contributions??[]){if(contribution.kind!=='app.panel'||contribution.surface!=='workspace.tool')continue;const Component=app.panels.get(contribution.id);if(Component)tools.push({id:aliases.get(`${record.id}:${contribution.id}`)??`plugin:${record.id}:${contribution.id}`,title:String(contribution.title??contribution.id),description:String(contribution.description??record.name??record.id),icon:String(contribution.icon??'extension'),Component,generation:app.identity.generation});}}
 return <Context.Provider value={{tools,builtins:['files','changes','terminal','browser'].map(id=>({id})),error:plugins?.error}}>{children}</Context.Provider>;
}
export function WorkspaceTool({kind,session,workbench,...props}){const {tools,error}=useWorkspaceExtensions(),tool=tools.find(item=>item.id===kind);if(!tool)return <div className="context-tool-failure" role="status"><h2>{error?'工具加载失败':'工具插件未启用'}</h2><p>可在设置 → 插件中安装或启用此工作区工具。</p>{error&&<p>{error}</p>}</div>;const Component=tool.Component;return <Component key={tool.generation} fileTarget={props.fileTarget} visible={props.visible} initialUrl={props.initialUrl} onTitle={props.onTitle} onNavigate={props.onNavigate} emptyState={props.emptyState} sessionId={session?.id} workspaceId={session?.workspaceId??workbench?.workspaces?.find(workspace=>workspace.path===session?.workspace)?.id}/>;}
