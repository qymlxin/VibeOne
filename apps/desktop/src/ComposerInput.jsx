import React,{useEffect,useId,useRef,useState} from 'react';
import {File,Folder,Slash,X,AtSign,RefreshCw} from 'lucide-react';
import {composerToken,replaceToken,commandOptions} from './composer.js';
import './composer.css';

export function ComposerInput({session,workbench,value,onChange,files,onFiles,onSubmit,onPanel,disabled,online,placeholder}) {
  const input=useRef(null),root=useRef(null),cache=useRef(new Map());
  const [token,setToken]=useState(null),[selected,setSelected]=useState(0),[listing,setListing]=useState(null),[error,setError]=useState('');
  const [refresh,setRefresh]=useState(0);
  const listId=useId();
  const directory=token?.kind==='@'?(token.query.includes('/')?token.query.slice(0,token.query.lastIndexOf('/')+1):''):'';
  const query=token?.kind==='@'?token.query.slice(directory.length):'';
  useEffect(()=>{
    if(token?.kind!=='@')return;
    let stale=false;const controller=new AbortController();setError('');setListing(null);
    if(!online){setError('连接主机后可浏览文件');return;}
    const cacheKey=`${session.id}:${directory}`;
    const cached=cache.current.get(cacheKey);
    if(cached){setListing(cached);return;}
    const timer=setTimeout(()=>{
      workbench.read(`/sessions/${session.id}/tree?path=${encodeURIComponent(directory||'.')}`,controller.signal).then(result=>{
        if(stale)return;const normalized={...result,entries:(result.entries??[]).map(item=>({...item,path:item.path.replace(/^\.\//,'')}))};cache.current.set(cacheKey,normalized);setListing(normalized);
      }).catch(reason=>{if(!stale)setError(String(reason.message??reason));});
    },150);
    return()=>{stale=true;controller.abort();clearTimeout(timer);};
  },[directory,token?.kind,online,session.id,workbench.read,refresh]);
  useEffect(()=>{const close=event=>{if(!root.current?.contains(event.target))setToken(null);};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close);},[]);
  const options=token?.kind==='/'?commandOptions(session.agentState?.commands,token.query):(listing?.entries??[])
    .filter(item=>item.kind!=='symlink'&&item.name.toLowerCase().includes(query.toLowerCase()))
    .sort((a,b)=>(a.kind==='directory'?0:1)-(b.kind==='directory'?0:1)||a.name.localeCompare(b.name));
  useEffect(()=>setSelected(0),[token?.query,listing]);
  useEffect(()=>{root.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({block:'nearest'});},[selected]);
  const update=(text,caret)=>{onChange(text);setToken(composerToken(text,caret));setError('');};
  const choose=item=>{
    if(!token)return;
    let insertion='';
    if(token.kind==='/'){
      if(item.panel)onPanel(item.panel);else insertion=`/${item.name} `;
    }else if(item.kind==='directory')insertion=`@"${item.path}/`;
    else{
      if(files.includes(item.path)){setError('此文件已引用');return;}
      if(files.length>=5){setError('每轮最多引用 5 个文本文件');return;}
      onFiles([...files,item.path]);
    }
    const next=replaceToken(value,token,insertion),caret=token.start+insertion.length;
    onChange(next);setToken(item.kind==='directory'?composerToken(next,caret):null);
    requestAnimationFrame(()=>{input.current?.focus();input.current?.setSelectionRange(caret,caret);});
  };
  const trigger=kind=>{
    const caret=input.current?.selectionStart??value.length;
    const before=value.slice(0,caret),insert=(before&&!/\s$/.test(before)?' ':'')+kind;
    const text=before+insert+value.slice(caret);update(text,caret+insert.length);
    requestAnimationFrame(()=>{input.current?.focus();input.current?.setSelectionRange(caret+insert.length,caret+insert.length);});
  };
  return <section className="composer-input" ref={root}>
    {!!files.length&&<div className="composer-references" aria-label="已引用文件">{files.map(path=><span key={path} title={path}><File size={14}/><span>{path}</span><button type="button" disabled={disabled} aria-label={`移除引用 ${path}`} onClick={()=>onFiles(files.filter(file=>file!==path))}><X size={13}/></button></span>)}</div>}
    {token&&!disabled&&<div className="composer-picker">
      <div className="composer-picker-heading">{token.kind==='/'?'指令':'工作区文件'}<small>{token.kind==='/'?'Agent 命令插入后发送':'最多 5 个文本文件 · 每个 32 KiB'}</small>{token.kind==='@'&&<button type="button" aria-label="刷新引用目录" disabled={!online} onClick={()=>{cache.current.delete(`${session.id}:${directory}`);setRefresh(count=>count+1);}}><RefreshCw size={14}/></button>}<button type="button" aria-label="关闭建议" onClick={()=>setToken(null)}><X size={14}/></button></div>
      {token.kind==='@'&&directory&&<button type="button" className="composer-parent" onClick={()=>{const parent=directory.replace(/\/$/,'').split('/').slice(0,-1).join('/');const insertion=parent?'@\"'+parent+'/':'@';const next=replaceToken(value,token,insertion),caret=token.start+insertion.length;update(next,caret);requestAnimationFrame(()=>{input.current?.focus();input.current?.setSelectionRange(caret,caret);});}}>‹ 上级目录 · {directory}</button>}
      <div id={listId} role="listbox" aria-label={token.kind==='/'?'指令建议':'文件建议'}>{options.map((item,index)=><button type="button" role="option" id={`${listId}-${index}`} aria-selected={index===selected} key={item.path??item.name} onPointerMove={()=>setSelected(index)} onMouseDown={event=>event.preventDefault()} onClick={()=>choose(item)}>
        {token.kind==='/'?<Slash size={16}/>:item.kind==='directory'?<Folder size={16}/>:<File size={16}/>}
        <span><strong>{token.kind==='/'?'/'+item.name:item.name}</strong><small>{item.description??(item.kind==='directory'?'打开目录':item.path)}</small></span>{item.source&&<small>{item.source}</small>}
      </button>)}</div>
      {!options.length&&<p role={error?'alert':undefined}>{error|| (token.kind==='@'&&!listing?'正在读取目录…':token.kind==='/'?'未找到指令，按 Enter 仍可发送给 Agent':'没有匹配项，可刷新目录或返回上级')}</p>}
      {options.length>0&&error&&<p role="alert">{error}</p>}
      {listing?.truncated&&token.kind==='@'&&<p>目录仅显示前 300 项，请输入更具体的子目录。</p>}
      <footer>↑ ↓ 选择 · Enter / Tab 确认 · Esc 关闭</footer>
    </div>}
    <textarea ref={input} aria-label="发送任务" aria-autocomplete="list" aria-controls={token?listId:undefined} aria-expanded={!!token} aria-activedescendant={token&&options[selected]?`${listId}-${selected}`:undefined} disabled={disabled} value={value} placeholder={placeholder}
      onChange={event=>update(event.target.value,event.target.selectionStart)}
      onSelect={event=>{if(token)setToken(composerToken(value,event.target.selectionStart));}}
      onKeyDown={event=>{
        if(event.nativeEvent.isComposing||event.keyCode===229)return;
        if(token&&event.key==='Escape'){event.preventDefault();setToken(null);return;}
        if(token&&['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();setSelected(index=>(index+(event.key==='ArrowDown'?1:-1)+Math.max(1,options.length))%Math.max(1,options.length));return;}
        if(token&&['Enter','Tab'].includes(event.key)&&!event.shiftKey){
          if(options[selected]){event.preventDefault();choose(options[selected]);return;}
          if(event.key==='Enter'){event.preventDefault();if(token.kind==='/'){setToken(null);onSubmit();}return;}
          setToken(null);return;
        }
        if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();onSubmit();}
      }}/>
    <div className="composer-shortcuts"><button type="button" disabled={disabled} aria-label="选择指令" onClick={()=>trigger('/')}><Slash size={14}/>指令</button><button type="button" disabled={disabled} aria-label="引用文件" onClick={()=>trigger('@')}><AtSign size={14}/>引用文件</button></div>
  </section>;
}
