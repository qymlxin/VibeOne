import React,{useCallback,useEffect,useRef,useState} from 'react';
import {chooseWorkspace} from './api.js';
export function useProjects(workbench){
 const [items,setItems]=useState([]),[error,setError]=useState('');const generation=useRef(0);
 const reload=useCallback(async()=>{const epoch=++generation.current;try{const value=await workbench.call('/projects');if(epoch===generation.current){setItems(value.projects);setError('');}}catch(error){if(epoch===generation.current)setError(error.message);}},[workbench.call]);
 useEffect(()=>{if(workbench.phase!=='online')return;void reload();const timer=setInterval(()=>{if(!document.hidden)void reload();},30000);return()=>{generation.current++;clearInterval(timer);};},[workbench.phase,reload]);
 const save=async body=>{const value=await workbench.call('/projects',body);await reload();return value;};
 return {items,error,reload,save};
}
export function projectGroups(sessions=[],projects=[],workspaces=[]){
 if(!projects.length)return workspaces.map(w=>({id:`workspace:${w.id}`,name:w.name,paths:[w.path],implicit:true})).map(p=>({...p,sessions:sessions.filter(s=>p.paths.includes(s.workspace))})).filter(p=>p.sessions.length);
 return projects.map(p=>({...p,sessions:sessions.filter(s=>p.paths.includes(s.workspace))})).filter(p=>!p.implicit||p.sessions.length);
}
export function ProjectSettings({projects,workbench}){
 const [name,setName]=useState(''),[selected,setSelected]=useState(''),[path,setPath]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');const intent=useRef(crypto.randomUUID());
 const project=projects.items.find(p=>p.id===selected)??projects.items[0];
 const run=async operation=>{if(busy)return;setBusy(true);setError('');try{await operation();}catch(error){setError(error.message);}finally{setBusy(false);}};
 return <><section className="settings-group"><h2>项目</h2><p className="group-description">一个项目可引入多个工作目录，并创建多个会话。每个会话选择一个目录作为执行位置。</p><div className="settings-rows"><form className="settings-form" onSubmit={event=>{event.preventDefault();void run(async()=>{const value=await projects.save({id:intent.current,name});setSelected(value.id);setName('');intent.current=crypto.randomUUID();});}}><label>项目名称<input aria-label="新项目名称" value={name} onChange={e=>setName(e.target.value)} maxLength={120} placeholder="例如：我的应用"/></label><button className="settings-action" disabled={busy||!name.trim()}>创建项目</button></form></div></section>
 <section className="settings-group"><h2>引入工作目录</h2><div className="settings-rows">{project?<><div className="settings-row"><div><strong>项目</strong></div><div className="settings-control"><select aria-label="管理项目" value={project.id} onChange={e=>setSelected(e.target.value)}>{projects.items.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></div></div>{project.paths.map(p=><div className="settings-row" key={p}><code title={p}>{p}</code></div>)}<form className="settings-form" onSubmit={event=>{event.preventDefault();void run(async()=>{await projects.save({id:project.id,addPath:path});setPath('');});}}><label>工作目录<input aria-label="引入工作目录" value={path} onChange={e=>setPath(e.target.value)} placeholder="输入目录的绝对路径" list="project-directory-options"/></label><datalist id="project-directory-options">{workbench.workspaces.map(w=><option value={w.path} key={w.id}>{w.name}</option>)}</datalist><button type="button" className="settings-action" disabled={busy} onClick={()=>void run(async()=>{const path=await chooseWorkspace();if(path)setPath(path);})}>选择目录</button><button className="settings-action" disabled={busy||!path.trim()}>引入目录</button></form></>:<p>先创建一个项目，再引入工作目录。</p>}</div></section>{(error||projects.error)&&<p role="alert">{error||projects.error}</p>}</>;
}
