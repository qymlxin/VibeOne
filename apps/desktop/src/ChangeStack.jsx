import React,{useEffect,useRef,useState} from 'react';
import {ChevronDown,ChevronRight} from 'lucide-react';
import {FileTypeIcon,ChangeStatus} from './FileTypeIcon.jsx';
import {CodeText} from './CodeText.jsx';
import {codeLines} from './code-lines.js';
function ChangeFile({file,sessionId,workbench,selected,onSelect,revision,initialOpen}){
 const [open,setOpen]=useState(initialOpen),[result,setResult]=useState(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 const ref=useRef(null);
 useEffect(()=>{if(selected){setOpen(true);ref.current?.scrollIntoView({block:'nearest'});}},[selected]);
 useEffect(()=>{if(!open)return;let stale=false;setError('');setResult(null);const range=file.staged&&!file.unstaged;
 workbench.call(`/sessions/${sessionId}/${file.untracked?'file':'diff'}?path=${encodeURIComponent(file.path)}&staged=${range}`).then(value=>{if(!stale)setResult(value);}).catch(reason=>{if(!stale)setError(reason.message??String(reason));});return()=>{stale=true;};},[open,file.path,file.status,sessionId,revision,attempt]);
 let text=result?.text??'';
 if(file.untracked&&text){const rows=text.split('\n');if(rows.at(-1)==='')rows.pop();text=`@@ -0,0 +1,${rows.length} @@\n${rows.map(row=>'+'+row).join('\n')}`;}
 const lines=codeLines(text,true);
 return <article ref={ref} className="change-file"><button className="change-file-heading" aria-expanded={open} onClick={()=>{setOpen(!open);onSelect(file);}}>{open?<ChevronDown size={13}/>:<ChevronRight size={13}/>}<FileTypeIcon path={file.path} size={14}/><span className="change-file-path" title={file.path}>{file.path}</span><ChangeStatus file={file}/>{(file.added!=null||result&&!result.binary)&&<span className="patch-count"><em>+{file.added??lines.added}</em> <b>−{file.removed??lines.removed}</b></span>}</button>{open&&<>{error?<p role="alert">{error} <button onClick={()=>setAttempt(a=>a+1)}>重试</button></p>:!result?<p role="status">正在读取差异…</p>:result.binary?<p>二进制文件 · {result.size} 字节</p>:text?<pre className="explorer-code">{lines.rows.map((row,index)=><span className={`code-line explorer-code-line ${row.kind}`} key={index}><span className="explorer-line-number">{row.line??''}</span><span>{row.kind==='added'?'+':row.kind==='removed'?'−':''}</span><CodeText path={file.path} text={['added','removed'].includes(row.kind)?row.text.slice(1):row.text||' '}/></span>)}</pre>:<p>当前范围没有文本差异。</p>}{result?.truncated&&<p>内容超过显示上限，已截断。</p>}</>}</article>;
}
export function ChangeStack({files,selected,onSelect,sessionId,workbench,revision}){
 return <div className="change-stack">{files.length?files.map((file,index)=><ChangeFile key={file.path} file={file} selected={selected?.path===file.path} onSelect={onSelect} sessionId={sessionId} workbench={workbench} revision={revision} initialOpen={index===0}/>):<div className="explorer-empty">当前没有文件变更。</div>}</div>;
}
