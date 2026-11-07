import React,{useEffect,useImperativeHandle,useId,useLayoutEffect,useRef,useState} from 'react';
import {File,Folder,Slash,X,AtSign,RefreshCw,BookOpen,Users,Terminal,GitBranch,History,ChevronRight} from 'lucide-react';
import {composerToken,replaceToken,commandOptions,referenceOptions} from './composer.js';
import {discoverComposerSkills} from './composer-skills.js';
import {SessionAvatar} from './SessionIdentity.jsx';
import './composer.css';

export function ComposerInput({session,workbench,value,onChange,files,onFiles,onSubmit,onPanel,disabled,online,placeholder,inputActions,agents=[],group=false}) {
  const input=useRef(null),root=useRef(null),cache=useRef(new Map()),selection=useRef(null),dismissed=useRef(false),restoringSelection=useRef(false);
  const [token,setToken]=useState(null),[selected,setSelected]=useState(0),[listing,setListing]=useState(null),[error,setError]=useState('');
  const [refresh,setRefresh]=useState(0),[skillRefresh,setSkillRefresh]=useState(0);
  const [skills,setSkills]=useState([]),[skillError,setSkillError]=useState(''),[skillsLoading,setSkillsLoading]=useState(false);
  useEffect(()=>{
    if(!token||!online||disabled)return;
    let stale=false;const controller=new AbortController();setSkills([]);setSkillError('');setSkillsLoading(true);
    discoverComposerSkills(workbench.read,session.id,controller.signal).then(items=>{if(!stale)setSkills(items);}).catch(reason=>{if(!stale)setSkillError(`技能目录读取失败，可关闭后重试：${reason.message??reason}`);}).finally(()=>{if(!stale)setSkillsLoading(false);});
    return()=>{stale=true;controller.abort();};
  },[token?.kind,online,disabled,session.id,workbench.read,skillRefresh]);
  const listId=useId();
  useEffect(()=>{if(!value)setToken(null);},[value]);
  // Restore the caret in the same commit as the controlled value. A queued
  // animation frame could otherwise overwrite a newer user selection/input.
  useLayoutEffect(()=>{
    const pending=selection.current;
    if(!pending)return;
    selection.current=null;
    if(input.current?.value!==pending.text)return;
    // WebKit may fire focus before setSelectionRange, while the caret is still
    // at zero. The trigger already owns the token for this controlled update.
    restoringSelection.current=true;
    try{input.current.focus();input.current.setSelectionRange(pending.caret,pending.caret);}
    finally{restoringSelection.current=false;}
  });
  const directory=token?.kind==='@'?(token.query.includes('/')?token.query.slice(0,token.query.lastIndexOf('/')+1):''):'';
  const query=token?.kind==='@'?token.query.slice(directory.length):'';
  useEffect(()=>{
    if(token?.kind!=='@'||group)return;
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
  const mentions=directory?[]:agents.filter(a=>a.name.toLowerCase().includes((token?.query??'').toLowerCase())).map(a=>({...a,kind:'agent',source:group?'会话组成员':'项目 Agent',description:group?'指定处理成员':'提及项目成员'}));
  const options=token?.kind==='/'?commandOptions(group?[]:session.agentState?.commands,token.query,skills):[...mentions,...(group?[]:referenceOptions(listing?.entries,query,skills,directory))];
  useEffect(()=>setSelected(0),[token?.query,listing,skills]);
  useEffect(()=>{root.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({block:'nearest'});},[selected]);
  const update=(text,caret)=>{dismissed.current=false;onChange(text);setToken(composerToken(text,caret));setError('');};
  const choose=(item,referenceDirectory=false)=>{
    if(!token)return;
    let insertion='';
    if(referenceDirectory){
      const path=item.path.endsWith('/')?item.path:item.path+'/';
      if(files.includes(path)){setError('此文件夹已引用');return;}
      if(files.length>=5){setError('每轮最多引用 5 个文件或文件夹');return;}
      onFiles([...files,path]);
    }else if(item.kind==='agent'){insertion='@'+item.name+' ';
    }else if(item.kind==='skill'&&group){insertion='请读取技能 '+item.path+' 并使用「'+item.name+'」处理以下任务：';
    }else if(item.kind==='skill'){
        if(!files.includes(item.path)&&files.length>=5){setError('每轮最多引用 5 个文件或文件夹，请先移除一个引用');return;}
        if(!files.includes(item.path))onFiles([...files,item.path]);
        insertion=`使用技能「${item.name}」处理以下任务：`;
    }else if(token.kind==='/'){
      if(item.panel)onPanel(item.panel);else insertion=`/${item.name} `;
    }else if(item.kind==='directory')insertion=`@"${item.path}/`;
    else{
      if(files.includes(item.path)){setError('此文件已引用');return;}
      if(files.length>=5){setError('每轮最多引用 5 个文件或文件夹');return;}
      onFiles([...files,item.path]);
    }
    const next=replaceToken(value,token,insertion),caret=token.start+insertion.length;
    selection.current={text:next,caret};
    onChange(next);setToken(item.kind==='directory'?composerToken(next,caret):null);
  };
  const trigger=kind=>{
    const caret=input.current?.selectionStart??value.length;
    const before=value.slice(0,caret),insert=(before&&!/\s$/.test(before)?' ':'')+kind;
    const text=before+insert+value.slice(caret);selection.current={text,caret:caret+insert.length};update(text,caret+insert.length);
  };
  useImperativeHandle(inputActions,()=>({trigger}));
  return <section className="composer-input" ref={root}>
    {!!files.length&&<div className="composer-references" aria-label="已引用文件">{files.map(path=><span key={path} title={path}>{path.endsWith('/')?<Folder size={14}/>:<File size={14}/>}<span>{path==='./'?'当前工作区':path.replace(/\/$/,'').split('/').at(-1)}</span><small>{path.endsWith('/')?'文件夹':'文件'}</small><button type="button" disabled={disabled} aria-label={`移除引用 ${path}`} onClick={()=>onFiles(files.filter(file=>file!==path))}><X size={13}/></button></span>)}</div>}
    {token&&!disabled&&<div className="composer-picker">
      <div className="composer-picker-heading">{token.kind==='/'?'指令':'引用上下文'}<small>{token.kind==='/'?'':'选择 Agent 或引用上下文'}</small>{token.kind==='@'&&<button type="button" aria-label="刷新引用目录" disabled={!online} onClick={()=>{cache.current.delete(`${session.id}:${directory}`);setRefresh(count=>count+1);setSkillRefresh(count=>count+1);}}><RefreshCw size={14}/></button>}<button type="button" aria-label="关闭建议" onClick={()=>setToken(null)}><X size={14}/></button></div>
      {token.kind==='@'&&directory&&<button type="button" className="composer-parent" onClick={()=>{const parent=directory.replace(/\/$/,'').split('/').slice(0,-1).join('/');const insertion=parent?'@\"'+parent+'/':'@';const next=replaceToken(value,token,insertion),caret=token.start+insertion.length;selection.current={text:next,caret};update(next,caret);}}>‹ 上级目录 · {directory}</button>}
      {token.kind==='@'&&!group&&listing&&workbench.features?.includes('directoryReferences')&&<button type="button" className="composer-parent" onClick={()=>choose({path:directory||'./'},true)}><Folder size={14}/> 引用{directory||'当前工作区'}文件夹 <small>仅目录清单</small></button>}
      <div id={listId} role="listbox" aria-label={token.kind==='/'?'指令建议':'引用建议'}>{options.map((item,index)=><React.Fragment key={item.id??item.path??item.name}>
        {token.kind==='/'&&(index===0||item.source!==options[index-1].source)&&<div className="composer-category" role="presentation">{item.kind==='skill'?'项目技能':item.source==='Agent'?'Agent 指令':'工作台'}</div>}
        {token.kind==='@'&&(index===0||item.kind!==options[index-1].kind)&&<div className="composer-category" role="presentation">{item.kind==='agent'?'Agent':item.kind==='skill'?'技能':'文件与文件夹'}</div>}
        <button type="button" role="option" id={`${listId}-${index}`} aria-selected={index===selected} key={item.id??item.path??item.name} onPointerMove={()=>setSelected(index)} onMouseDown={event=>event.preventDefault()} onClick={()=>choose(item)}>
        {item.kind==='agent'?<SessionAvatar color={item.color} shape={item.shape}/>:item.kind==='skill'?<BookOpen size={16}/>:item.panel==='terminal'?<Terminal size={16}/>:item.panel==='changes'?<GitBranch size={16}/>:item.panel==='runs'?<History size={16}/>:token.kind==='/'?<Slash size={16}/>:item.kind==='directory'?<Folder size={16}/>:<File size={16}/>}
        <span><strong>{item.label??item.name}</strong><small>{item.description??(item.kind==='directory'?'打开目录':item.path)}</small></span>{item.source&&<small>{item.source}</small>}
      </button></React.Fragment>)}</div>
      {!options.length&&<p role={error?'alert':undefined}>{error|| (token.kind==='@'&&!group&&!listing?'正在读取目录…':token.kind==='/'?'未找到指令，按 Enter 仍可发送给 Agent':'没有匹配项，可刷新目录或返回上级')}</p>}
      {options.length>0&&error&&<p role="alert">{error}</p>}
      {(token.kind==='/'||!directory)&&skillsLoading&&<p role="status">正在读取项目技能…</p>}
      {(token.kind==='/'||!directory)&&skillError&&<p role="alert">{skillError} <button type="button" className="composer-retry" onClick={()=>setSkillRefresh(count=>count+1)}>重试技能目录</button></p>}
      {listing?.truncated&&token.kind==='@'&&<p>目录仅显示前 300 项，请输入更具体的子目录。</p>}
      <footer>↑ ↓ 选择 · Enter / Tab 确认 · Esc 关闭</footer>
    </div>}
    <textarea ref={input} aria-label={group?"发送组消息":"发送任务"} aria-haspopup="listbox" aria-autocomplete="list" aria-controls={token?listId:undefined} aria-expanded={!!token} aria-activedescendant={token&&options[selected]?`${listId}-${selected}`:undefined} disabled={disabled} value={value} placeholder={placeholder}
      onChange={event=>update(event.target.value,event.target.selectionStart)}
      onClick={event=>{dismissed.current=false;setToken(composerToken(value,event.currentTarget.selectionStart));}}
      onFocus={event=>{if(restoringSelection.current)return;dismissed.current=false;setToken(composerToken(value,event.currentTarget.selectionStart));}}
      onSelect={event=>{if(token&&!dismissed.current)setToken(composerToken(value,event.target.selectionStart));}}
      onKeyDown={event=>{
        if(event.nativeEvent.isComposing||event.keyCode===229)return;
        if(token&&event.key==='Escape'){event.preventDefault();dismissed.current=true;setToken(null);return;}
        if(token&&['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();setSelected(index=>(index+(event.key==='ArrowDown'?1:-1)+Math.max(1,options.length))%Math.max(1,options.length));return;}
        if(token&&['Enter','Tab'].includes(event.key)&&!event.shiftKey){
          if(options[selected]){event.preventDefault();choose(options[selected]);return;}
          if(event.key==='Enter'){event.preventDefault();if(token.kind==='/'){setToken(null);onSubmit();}return;}
          setToken(null);return;
        }
        if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();onSubmit();}
      }}/>

  </section>;
}
