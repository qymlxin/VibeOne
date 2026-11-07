import React,{useEffect,useRef,useState} from 'react';
import {Download,FolderGit2,Search,Package,Check,AlertCircle} from 'lucide-react';
import {invoke} from './native.js';
export function RemotePluginInstall({workbench,plugins,source}){
 const [repository,setRepository]=useState('https://github.com/qymlxin/VibeOnePlugin');
 const [catalog,setCatalog]=useState(null),[chosen,setChosen]=useState([]),[workspaces,setWorkspaces]=useState([]),[trusted,setTrusted]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[query,setQuery]=useState(''),[results,setResults]=useState({}),[progress,setProgress]=useState('');
 const epoch=useRef(0);useEffect(()=>()=>{epoch.current++;},[]);
 const reset=()=>{epoch.current++;setCatalog(null);setChosen([]);setTrusted(false);setResults({});setError('');setQuery('');setProgress('');};
 useEffect(()=>{if(source?.repository&&source.repository!==repository){setRepository(source.repository);reset();}},[source?.repository]);
 const selected=(catalog?.packages??[]).filter(item=>chosen.includes(item.path));
 const permissions=[...new Set(selected.flatMap(item=>item.manifest.hostRequirements??[]))];
 const rows=(catalog?.packages??[]).filter(item=>`${item.manifest.name} ${item.manifest.id} ${item.source.directory}`.toLowerCase().includes(query.toLowerCase()));
 const eligible=rows.filter(item=>!item.error&&results[item.path]?.state!=='success');
 const changeChosen=next=>{setChosen(next);setTrusted(false);};
 async function discover(){
  const request=++epoch.current;setBusy(true);setError('');setProgress('正在下载仓库…');setCatalog(null);setChosen([]);setTrusted(false);setResults({});
  try{
   const fetched=await invoke('plugin_fetch',{repository});
   if(request!==epoch.current)return;
   setProgress('正在检查插件清单…');
   // Inspect in bounded batches; Host limits pending lifecycle operations.
   const packages=[];
   for(let start=0;start<fetched.packages.length;start+=3){
    const checked=await Promise.all(fetched.packages.slice(start,start+3).map(async item=>{try{return {...item,manifest:await workbench.managePlugin('inspect',{path:item.path})};}catch(reason){return {...item,manifest:{name:item.manifest?.name??item.source.directory,id:item.manifest?.id,version:item.manifest?.version},error:reason.message??String(reason)};}}));
    packages.push(...checked);
   }
   if(request!==epoch.current)return;
   const counts=new Map();for(const item of packages)counts.set(item.manifest.id,(counts.get(item.manifest.id)??0)+1);
   for(const item of packages)if(counts.get(item.manifest.id)>1)item.error='仓库中存在重复插件ID，请发布者修正后重新解析';
   setCatalog({...fetched,packages});setWorkspaces((workbench.workspaces??[]).map(w=>w.id));setQuery('');
  }catch(reason){if(request===epoch.current)setError(reason.message??String(reason));}
  finally{if(request===epoch.current){setBusy(false);setProgress('');}}
 }
 async function install(){
  const request=epoch.current;setBusy(true);setError('');const failed=[];
  for(const [index,item] of selected.entries()){
   if(request!==epoch.current)break;
   setProgress(`正在安装 ${index+1}/${selected.length} · ${item.manifest.name}`);
   try{
    const installed=workbench.plugins?.find(p=>p.id===item.manifest.id);
    await plugins.install({path:item.path,source:item.source,trusted:true,workspaces,config:installed?.config??{},expectedManifest:item.manifest});
    if(request===epoch.current)setResults(current=>({...current,[item.path]:{state:'success'}}));
   }catch(reason){failed.push(item.path);if(request===epoch.current)setResults(current=>({...current,[item.path]:{state:'failed',message:reason.message??String(reason)}}));}
  }
  if(request===epoch.current){setChosen(failed);setBusy(false);setTrusted(false);setProgress('');}
 }
 return <section className="remote-plugin-install"><h2><FolderGit2 size={17}/>从仓库安装插件</h2><p>输入一个仓库地址，自动发现其中的插件，选择需要的功能安装或更新。</p><div className="remote-plugin-fields"><label>GitHub 仓库<input value={repository} disabled={busy} onChange={event=>{setRepository(event.target.value);reset();}} placeholder="https://github.com/owner/plugins"/></label><button disabled={busy||!repository.trim()} onClick={()=>void discover()}><Download size={14}/>{busy?'正在处理…':catalog?'重新解析':'解析仓库'}</button></div>
 {busy&&<p role="status">{progress}</p>}{error&&<p role="alert">{error}</p>}
 {catalog&&<div className="repository-plugin-catalog"><header><div><strong>发现 {catalog.packages.length} 个插件</strong><small>提交 {catalog.source.revision.slice(0,12)} · 安装使用此次解析的版本</small></div><label className="repository-plugin-search"><Search size={14}/><input aria-label="筛选仓库插件" value={query} onChange={event=>setQuery(event.target.value)} placeholder="搜索插件…"/></label></header>
 {!!catalog.packages.length&&<label className="repository-plugin-select-all"><input type="checkbox" disabled={busy||!eligible.length} checked={eligible.length>0&&eligible.every(item=>chosen.includes(item.path))} onChange={event=>changeChosen(event.target.checked?[...new Set([...chosen,...eligible.map(item=>item.path)])]:chosen.filter(p=>!eligible.some(item=>item.path===p)))}/>选择当前列表的可安装插件</label>}
 <div className="repository-plugin-list">{rows.map(item=>{const installed=workbench.plugins?.find(p=>p.id===item.manifest.id),result=results[item.path];return <label key={item.path} className={`repository-plugin-row ${item.error?'invalid':''}`}><input type="checkbox" aria-label={`选择${item.manifest.name}`} checked={chosen.includes(item.path)} disabled={busy||!!item.error||result?.state==='success'} onChange={event=>changeChosen(event.target.checked?[...chosen,item.path]:chosen.filter(p=>p!==item.path))}/><span className="repository-plugin-icon"><Package size={18}/></span><span className="repository-plugin-copy"><strong>{item.manifest.name}<span>{item.manifest.version??'无版本'}</span></strong><small>{item.manifest.description||item.manifest.id} · {item.source.directory||'仓库根目录'}</small>{item.error&&<em>{item.error}</em>}{result?.state==='failed'&&<em>{result.message}</em>}</span><span className="repository-plugin-state">{result?.state==='success'?<><Check size={14}/>已安装</>:result?.state==='failed'?<><AlertCircle size={14}/>安装失败</>:installed?`已安装 ${installed.version}`:'未安装'}</span></label>;})}</div>
 {!rows.length&&<p>{catalog.packages.length?'没有匹配的插件。':'未发现插件包。仓库应在根目录或子目录中包含 plugin.json 及构建产物。'}</p>}
 {!!catalog.warnings.length&&<details><summary>有 {catalog.warnings.length} 个目录未能解析</summary>{catalog.warnings.map((warning,index)=><p key={index}>{warning}</p>)}</details>}
 {selected.length>0&&<div className="remote-plugin-candidate"><strong>已选 {selected.length} 个插件</strong><p>所需权限：{permissions.join('、')||'无'}</p>{permissions.some(p=>['workspace.read','artifact.write','desktop.terminal'].includes(p))&&<fieldset><legend>授权工作目录（应用于本次选中的插件）</legend>{(workbench.workspaces??[]).map(w=><label key={w.id}><input type="checkbox" disabled={busy} checked={workspaces.includes(w.id)} onChange={event=>{setWorkspaces(current=>event.target.checked?[...current,w.id]:current.filter(id=>id!==w.id));setTrusted(false);}}/>{w.name}</label>)}</fieldset>}<label><input type="checkbox" disabled={busy} checked={trusted} onChange={event=>setTrusted(event.target.checked)}/>信任选中的插件及上述权限</label><button disabled={busy||!trusted} onClick={()=>void install()}>安装 / 更新所选 {selected.length} 个插件</button></div>}
 {Object.values(results).some(result=>result.state==='success')&&<p role="status">已成功安装 {Object.values(results).filter(result=>result.state==='success').length} 个插件并启用，无需重启桌面。{Object.values(results).some(result=>result.state==='failed')?'失败的插件可单独重试，成功项不会重复安装。':''}</p>}
 </div>}
 </section>;
}
