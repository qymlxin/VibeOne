import React,{useEffect,useState} from 'react';
import {ArrowLeft,ArrowRight,ExternalLink,RotateCw} from 'lucide-react';
import {isNative,openExternal} from './api.js';
import {previewUrl} from './preview-links.js';
export function BrowserPreview({url,onNavigate,canBack,canForward,onBack,onForward}){
 const [draft,setDraft]=useState(url??''),[attempt,setAttempt]=useState(0),[state,setState]=useState('idle'),[error,setError]=useState('');
 useEffect(()=>setDraft(url??''),[url]);
 useEffect(()=>{if(!url)return;setState('loading');const timeout=setTimeout(()=>setState(current=>current==='loading'?'timeout':current),12000);return()=>clearTimeout(timeout);},[url,attempt]);
 const safe=previewUrl(url);
 return <section className="desktop-browser"><form onSubmit={event=>{event.preventDefault();const next=previewUrl(draft);if(!next){setError('请输入完整的 HTTP 或 HTTPS 地址。');return;}if(new URL(next).origin===location.origin){setError('应用自身页面请在当前窗口操作。');return;}setError('');onNavigate(next);}}><button type="button" aria-label="返回上一网页" disabled={!canBack} onClick={onBack}><ArrowLeft size={14}/></button><button type="button" aria-label="前进到下一网页" disabled={!canForward} onClick={onForward}><ArrowRight size={14}/></button><input aria-label="预览网址" value={draft} onChange={event=>setDraft(event.target.value)} placeholder="https://example.com"/><button aria-label="打开网址预览">打开</button><button type="button" aria-label="重新加载网页" disabled={!safe} onClick={()=>setAttempt(value=>value+1)}><RotateCw size={14}/></button></form>{error&&<p role="alert">{error}</p>}
 {safe?<><div className="desktop-browser-notice"><span role="status">{({loading:'正在加载网页…',timeout:'网页仍未就绪，站点可能不允许内嵌。',error:'网页加载失败。',loaded:'网页已请求加载；内容可用性取决于站点。'})[state]}</span><a href={safe} target="_blank" rel="noopener noreferrer" onClick={event=>{if(isNative()){event.preventDefault();void openExternal(safe).catch(error=>setError(String(error)));}}}>在浏览器打开<ExternalLink size={12}/></a></div><iframe key={`${safe}:${attempt}`} title="网页预览" src={safe} sandbox="allow-scripts allow-forms" referrerPolicy="no-referrer" onLoad={()=>setState('loaded')} onError={()=>setState('error')}/><p className="desktop-browser-help">网页独立加载，无主机或桌面操作权限；空白或无法登录时可在浏览器中打开。</p></>:<p className="desktop-browser-help">点击答案中的网页链接，或输入地址，在旁边预览。</p>}
 </section>;
}
