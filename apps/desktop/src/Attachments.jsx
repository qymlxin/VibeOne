import React,{useContext,useEffect,useRef,useState} from 'react';
import {File,Paperclip,X} from 'lucide-react';
import {PreviewContext} from './PreviewLinks.jsx';
import './attachments.css';
const imageTypes=new Set(['image/png','image/jpeg','image/gif','image/webp']);
const key=id=>`vibeone-attachments:${id}`;
function readDraft(id){try{const items=JSON.parse(localStorage.getItem(key(id))??'[]');return Array.isArray(items)?items.filter(item=>typeof item.id==='string'&&typeof item.name==='string'&&['image','text','resource'].includes(item.kind)).slice(0,5):[];}catch{return [];}}
const encode=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]??'');reader.onerror=()=>reject(Error('无法读取文件'));reader.onabort=()=>reject(Error('文件读取已取消'));reader.readAsDataURL(file);});
export function useAttachmentDraft({session,workbench,disabled,onMutate}){
 const [items,setItems]=useState(()=>readDraft(session.id)),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const current=useRef(items),uploading=useRef(false);
 const replace=next=>{current.current=next;setItems(next);onMutate();try{if(next.length)localStorage.setItem(key(session.id),JSON.stringify(next));else localStorage.removeItem(key(session.id));}catch{}};
 async function add(files){
  if(disabled||uploading.current)return;
  if(workbench.phase!=='online'){setError('连接主机后可上传附件');return;}
  if(!workbench.features?.includes('attachments')){setError('主机尚不支持附件，结束执行后在设置中重启主机以更新。');return;}
  uploading.current=true;setBusy(true);setError('');
  try{for(const file of files){
    if(current.current.length>=5)throw Error('每轮最多添加5个上传附件');
    if(current.current.reduce((total,item)=>total+item.size,0)+file.size>16*1024*1024)throw Error('每轮上传附件总量不能超过16MiB');
    if(file.size>4*1024*1024)throw Error(`${file.name} 超过4MiB限制`);
    const encoded=await encode(file);
    const mimeType=file.type==='image/svg+xml'?'text/plain':file.type||'application/octet-stream';
    const item=await workbench.call(`/sessions/${session.id}/attachments`,{name:file.name,mimeType,data:encoded});
    if(!current.current.some(previous=>previous.id===item.id))replace([...current.current,item]);
  }}catch(reason){setError(reason.message??String(reason));}
  finally{uploading.current=false;setBusy(false);}
 }
 async function remove(item){if(disabled||uploading.current)return;replace(current.current.filter(previous=>previous.id!==item.id));if(workbench.phase!=='online')return;try{await workbench.call(`/sessions/${session.id}/attachments/${encodeURIComponent(item.id)}/remove`,{});}catch{setError('已移出草稿，但主机缓存清理失败；历史附件仍保留。');}}
 const onPaste=event=>{const files=[...(event.clipboardData?.files??[])];if(files.length){event.preventDefault();void add(files);}};
 const onDrop=event=>{if(!event.dataTransfer?.types.includes('Files'))return;event.preventDefault();if([...event.dataTransfer.items].some(item=>item.webkitGetAsEntry?.()?.isDirectory)){setError('文件夹请使用 @ 工作区引用，或选择其中的文件。');return;}void add([...event.dataTransfer.files]);};
 return {items,busy,error,add,remove,replace,online:workbench.phase==='online',onPaste,onDrop,onDragOver:event=>{if(event.dataTransfer?.types.includes('Files'))event.preventDefault();}};
}
export function AttachmentCard({item,onRemove,disabled=false}){
 const context=useContext(PreviewContext),ref=useRef(null);
 const [image,setImage]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const url=`/sessions/${context?.sessionId}/attachments/${encodeURIComponent(item.id)}`;
 useEffect(()=>{
  if(item.kind!=='image'||!context?.read)return;
  let started=false,disposed=false;const controller=new AbortController();
  const load=()=>{if(started)return;started=true;void context.read(url,controller.signal).then(value=>{if(!disposed&&value.kind==='image'&&imageTypes.has(value.mimeType))setImage(`data:${value.mimeType};base64,${value.data}`);}).catch(reason=>{if(!disposed)setError(reason.message??'附件不可用');});};
  const observer=typeof IntersectionObserver==='undefined'?null:new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))load();});
  if(observer&&ref.current)observer.observe(ref.current);else load();
  return()=>{disposed=true;controller.abort();observer?.disconnect();};
 },[item.id,item.kind,context?.read,url]);
 async function download(){setBusy(true);setError('');try{
  const value=await context.read(url);const bytes=Uint8Array.from(atob(value.data),character=>character.charCodeAt(0));
  const resource=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'}));const anchor=document.createElement('a');anchor.href=resource;anchor.download=value.name;anchor.click();setTimeout(()=>URL.revokeObjectURL(resource),30000);
 }catch(reason){setError(reason.message??String(reason));}finally{setBusy(false);}}
 return <div ref={ref} className="desktop-attachment-card"><div className="desktop-attachment-heading"><File size={13}/><span title={item.name}>{item.name}</span>{onRemove&&<button type="button" disabled={disabled} aria-label={`移除附件 ${item.name}`} onClick={()=>onRemove(item)}><X size={13}/></button>}</div>
  {item.kind==='image'?image?<details><summary aria-label={`预览图片 ${item.name}`}><img src={image} alt={item.name}/><small>展开 / 收起</small></summary><img className="desktop-attachment-full" src={image} alt={`${item.name} 大图`}/></details>:<p>{error?'图片暂不可用':'正在读取缩略图…'}</p>:<small>{Math.ceil(item.size/1024)} KiB · {item.kind==='text'?'文本附件':'文件附件'}</small>}
  {!onRemove&&context?.read&&<button type="button" className="desktop-attachment-download" disabled={busy} onClick={()=>void download()}>{busy?'正在读取…':'下载附件'}</button>}
  {error&&<small role="status">{error}</small>}
 </div>;
}
export function AttachmentCards({items}){return items?.length?<div className="desktop-attachment-cards">{items.map(item=><AttachmentCard key={item.id} item={item}/>)}</div>:null;}
export function AttachmentPicker({draft,disabled,supported}){
 const input=useRef(null);
 return <section className="desktop-attachment-picker"><div className="desktop-attachment-cards">{draft.items.map(item=><AttachmentCard key={item.id} item={item} disabled={disabled||draft.busy} onRemove={item=>void draft.remove(item)}/>)}</div><input ref={input} hidden type="file" multiple aria-label="选择附件文件" disabled={disabled||draft.busy||!supported||!draft.online} onChange={event=>{void draft.add([...event.target.files]);event.target.value='';}}/><button type="button" disabled={disabled||draft.busy||!supported||!draft.online} onClick={()=>input.current?.click()} title={supported?'选择文件，也可以拖入文件或粘贴图片':'需结束执行后重启主机以启用附件'}><Paperclip size={14}/>{draft.busy?'正在添加附件…':'添加附件'}</button>{draft.error&&<p role="alert">{draft.error}</p>}{draft.items.length>0&&<small>固定内容 · 每个4MiB · 最多5个 · Agent连接后校验媒体能力</small>}</section>;
}
