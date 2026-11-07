import React,{useEffect,useRef,useState} from 'react';
import {ChevronRight,FileText,Folder,PanelRight,Search} from 'lucide-react';
import {codeLines} from './code-lines.js';
import './file-explorer.css';
const clean=path=>path.replace(/^\.\//,'');
export function FileExplorer({session,workbench,tab,fileTarget,artifactCapture:capture}){
 const online=workbench.phase==='online';
 const [directories,setDirectories]=useState(()=>Object.create(null)),[expanded,setExpanded]=useState(new Set(['.'])),[result,setResult]=useState(null),[preview,setPreview]=useState(null),[selected,setSelected]=useState(null),[filter,setFilter]=useState(''),[showTree,setShowTree]=useState(true),[path,setPath]=useState('.'),[pathDraft,setPathDraft]=useState('.'),[navigating,setNavigating]=useState(false),[directoryErrors,setDirectoryErrors]=useState(()=>Object.create(null)),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const generation=useRef(0),selectionId=useRef(0),pending=useRef(new Map()),navigationId=useRef(0);
 const root=useRef(null);
 async function directory(path='.',epoch=generation.current){
   if(pending.current.has(path))return pending.current.get(path);
   setDirectoryErrors(previous=>{const next=Object.assign(Object.create(null),previous);delete next[path];return next;});
   const reading=Promise.resolve().then(async()=>{
     try{
       const value=await workbench.call(`/sessions/${session.id}/tree?path=${encodeURIComponent(path)}`);
       const normalized={...value,entries:value.entries.map(item=>({...item,path:clean(item.path)}))};
       if(epoch===generation.current)setDirectories(previous=>Object.assign(Object.create(null),previous,{[path]:normalized}));
       return normalized;
     }catch(reason){
       if(epoch===generation.current){const message=reason.message??String(reason);setError(message);setDirectoryErrors(previous=>Object.assign(Object.create(null),previous,{[path]:message}));}
       return null;
     }finally{if(epoch===generation.current)pending.current.delete(path);}
   });
   pending.current.set(path,reading);return reading;
 }
 async function navigate(target){
   const epoch=generation.current,id=++navigationId.current;
   setNavigating(true);setError('');
   const value=await directory(target||'.',epoch);
   if(epoch!==generation.current||id!==navigationId.current)return;
   if(value){setPath(target||'.');setPathDraft(target||'.');setExpanded(previous=>new Set([...previous,target||'.']));setFilter('');}
   setNavigating(false);
 }
 async function load(epoch=generation.current,rootPath=path){
   setBusy(true);setError('');
   try{if(tab==='changes'){const value=await workbench.call(`/sessions/${session.id}/changes`);if(epoch===generation.current)setResult(value);}else await directory(rootPath,epoch);}
   catch(reason){if(epoch===generation.current)setError(reason.message??String(reason));}
   finally{if(epoch===generation.current)setBusy(false);}
 }
 useEffect(()=>{const epoch=++generation.current;selectionId.current++;pending.current=new Map();navigationId.current++;setNavigating(false);setDirectoryErrors(Object.create(null));setDirectories(Object.create(null));setExpanded(new Set(['.']));setResult(null);setPreview(null);setSelected(null);setPath('.');setPathDraft('.');setFilter('');void load(epoch,'.');return()=>{generation.current++;selectionId.current++;};},[session.id,tab]);
 async function inspect(file,staged=false){
   const id=++selectionId.current,epoch=generation.current;
   setSelected({...file,stagedView:staged});setPreview(null);setError('');
   try{const value=await workbench.call(`/sessions/${session.id}/${tab==='changes'&&!file.untracked?'diff':'file'}?path=${encodeURIComponent(file.path)}&staged=${staged}`);if(id===selectionId.current&&epoch===generation.current)setPreview({...value,isDiff:tab==='changes'&&!file.untracked});}
   catch(reason){if(id===selectionId.current&&epoch===generation.current)setError(reason.message??String(reason));}
 }
 useEffect(()=>{if(fileTarget?.path&&tab==='files')void inspect({path:clean(fileTarget.path)});},[fileTarget,tab,session.id]);
 const toggle=path=>{setExpanded(previous=>{const next=new Set(previous);if(next.has(path))next.delete(path);else next.add(path);return next;});if(!directories[path]){setError('');void directory(path);}};
 const fileButton=file=><div className="explorer-file-row" key={file.path}><button aria-current={selected?.path===file.path?'true':undefined} title={file.path} onClick={()=>void inspect(file,tab==='changes'&&file.staged&&!file.unstaged)}><FileText size={13}/><span>{file.name??file.path}</span>{file.status&&<small>{file.status}</small>}</button></div>;
 const tree=directoryPath=><ul>{directories[directoryPath]?.entries.filter(file=>file.kind==='directory'||file.path.toLowerCase().includes(filter.toLowerCase())).map(file=><li key={file.path}>{file.kind==='directory'?<><button className="explorer-directory" aria-expanded={expanded.has(file.path)} onClick={()=>toggle(file.path)}><ChevronRight size={12}/><Folder size={13}/><span title={file.path}>{file.name}</span></button>{expanded.has(file.path)&&(directories[file.path]?tree(file.path):directoryErrors[file.path]?<div className="explorer-directory-error"><p>{directoryErrors[file.path]}</p><button aria-label={`重试读取 ${file.path}`} onClick={()=>{setError('');void directory(file.path);}}>重试读取</button></div>:<p role="status">正在读取目录…</p>)}</>:file.kind==='symlink'?<span className="explorer-symlink" title={file.path}>{file.name} · 符号链接</span>:fileButton(file)}</li>)}{directories[directoryPath]?.truncated&&<li>目录已截断，请打开更具体的路径。</li>}</ul>;
 const parts=path.split('/').filter(part=>part&&part!=='.');
 const trail=[{name:'工作区',path:'.'},...parts.map((name,index)=>({name,path:parts.slice(0,index+1).join('/')}))];
 const lines=codeLines(preview?.text??'',preview?.isDiff);
 return <section ref={root} className="desktop-inspector explorer" aria-label={tab==='changes'?'变更浏览器':'文件浏览器'}>
  <header><h2>{tab==='changes'?'工作区变更':'工作区文件'}</h2><div><button onClick={()=>{void load();if(selected)void inspect(selected,selected.stagedView);for(const path of expanded)if(path!=='.')void directory(path);}} disabled={busy||navigating}>刷新</button><button aria-label={showTree?'收起文件列表':'显示文件列表'} aria-pressed={showTree} onClick={()=>setShowTree(!showTree)}><PanelRight size={14}/></button></div></header>
  {tab==='files'&&<><form className="explorer-path" onSubmit={event=>{event.preventDefault();void navigate(pathDraft);}}><input aria-label="浏览目录" value={pathDraft} disabled={navigating} onChange={event=>setPathDraft(event.target.value)}/><button disabled={busy||navigating}>打开目录</button></form><nav className="explorer-breadcrumbs" aria-label="当前目录">{trail.map((item,index)=><React.Fragment key={item.path}>{index>0&&<ChevronRight size={12} aria-hidden="true"/>}<button title={item.path} disabled={navigating} aria-current={index===trail.length-1?'page':undefined} onClick={()=>void navigate(item.path)}>{item.name}</button></React.Fragment>)}</nav></>}
  {tab==='changes'&&<p className="explorer-notice">{result?.branch&&<strong>{result.branch} · </strong>}{result?.notice}</p>}
  {error&&<p role="alert">{error}</p>}{(busy||navigating)&&<p role="status">正在读取…</p>}
  {capture.busy&&<p role="status">正在确认产物保存…</p>}
  {capture.notice&&<p role="status">{capture.notice}</p>}
  {capture.failure&&<div className="explorer-capture-failure" role="alert"><p>保存 {capture.failure.path} 未确认：{capture.failure.message}</p><button disabled={!online||capture.busy} onClick={()=>void capture.retry()}>重试保存产物</button><button disabled={capture.busy} aria-label="关闭产物保存提示" onClick={capture.dismiss}>关闭提示</button></div>}
  <div className={`explorer-workspace ${showTree?'with-tree':''}`}>
   <article className="desktop-file-preview explorer-preview">
    {selected?<><header><strong title={selected.path}>{selected.path}</strong><button onClick={()=>{selectionId.current++;setSelected(null);setPreview(null);}}>关闭预览</button></header>
     {tab==='changes'&&!selected.untracked&&<div className="explorer-diff-modes"><button aria-pressed={!selected.stagedView} onClick={()=>void inspect(selected,false)}>未暂存差异</button><button aria-pressed={!!selected.stagedView} onClick={()=>void inspect(selected,true)}>已暂存差异</button></div>}
     {!preview&&!error&&<p role="status">正在读取文件…</p>}
     {preview&&<>{preview.binary?<p>二进制文件 · {preview.size} 字节</p>:<>
       <div className="explorer-code-heading"><span>{preview.isDiff?'统一差异':'UTF-8 · 只读'}</span>{preview.isDiff&&<span><em>+{lines.added}</em> <b>−{lines.removed}</b></span>}{tab==='files'&&(!workbench.device||workbench.device.role==='operator')&&<button disabled={!online||capture.busy||!!capture.failure} onClick={()=>void capture.save(preview.path)}>保存为文本产物</button>}</div>
       {preview.text?<pre className="explorer-code">{lines.rows.map((row,index)=><span className={`explorer-code-line ${row.kind}`} key={index}><span className="explorer-line-number" aria-hidden="true">{row.line??''}</span><code>{row.text||' '}</code></span>)}</pre>:<p>{preview.isDiff?'当前范围没有文本差异。':'空文件'}</p>}
       {lines.clipped&&<p>超过 5,000 行，当前预览仅显示前 5,000 行。</p>}
     </>}{preview.truncated&&<p>内容超过显示上限，已截断。</p>}</>}
    </>:<div className="explorer-empty"><FileText size={22}/><p>选择文件{tab==='changes'?'查看真实差异':'查看内容'}。</p>{!showTree&&<button onClick={()=>setShowTree(true)}>显示文件列表</button>}</div>}
   </article>
   {showTree&&<aside className="explorer-tree" aria-label="文件列表" aria-busy={navigating}><label><Search size={13}/><input aria-label="筛选文件" placeholder={tab==='changes'?'筛选变更文件…':'筛选已展开文件…'} value={filter} onChange={event=>setFilter(event.target.value)}/></label><p>{tab==='changes'?`变更文件 · ${result?.files?.length??0}`:'项目文件'}</p>{tab==='changes'?<>{(result?.files??[]).filter(file=>file.path.toLowerCase().includes(filter.toLowerCase())).map(fileButton)}{result?.truncated&&<p>变更列表已截断。</p>}{result&&!result.files.length&&<p>没有可显示的内容</p>}</>:<>{tree(path)}{directories[path]?.entries.length===0&&<p>没有可显示的内容</p>}</>}</aside>}
  </div>
 </section>;
}
