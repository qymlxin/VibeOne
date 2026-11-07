
// App plugins are trusted JavaScript. This facade defines supported, scoped SDK services;
// it is not a sandbox for arbitrary renderer code.
export function pluginServices(record,latest,snapshot,listeners,native){
 const {invoke,streamChannel}=native;
 const resourceId=id=>`${record.id}:${record.generation}:${id}`;
 const terminals=new Set(),browsers=new Set(),channels=new Map();
 let disposed=false,cachedSource,cachedValue;
 const current=()=>{const value=latest.current.plugins?.find(p=>p.id===record.id);if(disposed||!value?.enabled||value.generation!==record.generation)throw Error('插件已停用或版本已替换');return value;};
 const permission=name=>{if(!current().capabilities?.includes(name))throw Error(`插件未获授权：${name}`);};
 const authorized=(session,plugin=record)=>!!session&&plugin.workspaces?.some(id=>latest.current.workspaces?.some(w=>w.id===id&&w.path===session.workspace));
 const session=id=>{const value=latest.current.sessions?.find(s=>s.id===id);if(!authorized(value,current()))throw Error('此会话的工作目录未授权给插件');return value;};
 const owns=(set,id)=>{if(!set.has(id))throw Error('插件资源不存在');};
 const desktop={available:native.available,
  streamChannel(){current();const value=streamChannel();channels.set(value.events,value.dispose);const dispose=()=>{channels.delete(value.events);value.dispose();};return {...value,dispose};},
  async invoke(command,args={}){
   const terminal=command.startsWith('terminal_'),browser=command.startsWith('browser_');
   permission(terminal?'desktop.terminal':'desktop.browser');
   if(!terminal&&!browser&&command!=='open_external')throw Error('插件桌面命令不受支持');
   if(command==='terminal_open'){const source=latest.current.sessions?.find(s=>s.workspace===args.cwd&&authorized(s,current()));if(!source)throw Error('终端工作目录未授权');if(!channels.has(args.events))throw Error('终端事件通道未注册');terminals.add(args.id);}
   else if(terminal)owns(terminals,args.id);
   if(command==='browser_open'){if(!channels.has(args.events))throw Error('网页事件通道未注册');browsers.add(args.id);}else if(browser)owns(browsers,args.id);
   const result=await invoke(command,args.id?{...args,id:resourceId(args.id)}:args);
   if(command==='terminal_close')terminals.delete(args.id);
   if(command==='browser_action'&&args.action==='close')browsers.delete(args.id);
   return result;
  }
 };
 const services={desktop,workbench:{
  snapshot:()=>{const source=snapshot.current;if(source!==cachedSource){cachedSource=source;cachedValue={pluginEvents:(source.pluginEvents??[]).filter(e=>e.pluginId===record.id),sessions:(source.sessions??[]).filter(s=>authorized(s)),workspaces:(source.workspaces??[]).filter(w=>record.workspaces?.includes(w.id))};}return cachedValue;},
  subscribe:listener=>{listeners.current.add(listener);return()=>listeners.current.delete(listener);},
  request:async(endpoint,body)=>{const url=new URL(endpoint,'https://plugin.local');if(url.origin!=='https://plugin.local')throw Error('插件请求地址无效');const match=/^\/sessions\/([^/]+)\/(tree|file|diff|changes|artifacts)$/.exec(url.pathname);if(!match)throw Error('插件请求不受支持');session(decodeURIComponent(match[1]));permission(body===undefined?'workspace.read':'artifact.write');if(body!==undefined&&match[2]!=='artifacts')throw Error('插件不支持此写入操作');return latest.current.call(endpoint,body);}
 },invokeWorker:(handler,input,workspaceId)=>latest.current.invokePlugin(record.id,{handler,input,workspaceId,generation:record.generation})};
 return {services,async dispose(){disposed=true;for(const dispose of channels.values())dispose();channels.clear();for(const id of terminals)await invoke('terminal_close',{id:resourceId(id)}).catch(()=>{});for(const id of browsers)await invoke('browser_action',{id:resourceId(id),action:'close'}).catch(()=>{});terminals.clear();browsers.clear();}};
}
