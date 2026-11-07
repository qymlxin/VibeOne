import React,{useEffect,useRef} from 'react';
import {Channel,invoke} from '@tauri-apps/api/core';
export function NativeBrowserSurface({url,attempt,visible,onState,onLocation,controller}){
 const element=useRef(null),id=useRef(crypto.randomUUID()),ready=useRef(null),callbacks=useRef({onState,onLocation});callbacks.current={onState,onLocation};const last=useRef({url,attempt});const shown=useRef(visible);shown.current=visible;
 const bounds=()=>{const box=element.current?.getBoundingClientRect();return {x:Math.max(0,box?.x??0),y:Math.max(0,box?.y??0),width:Math.max(1,box?.width??1),height:Math.max(1,box?.height??1)};};
 useEffect(()=>{
  let disposed=false;const events=new Channel();events.onmessage=event=>{if(!disposed){callbacks.current.onState(event.state);callbacks.current.onLocation(event.url);}};
  const layout=()=>{if(disposed)return;void ready.current?.then(()=>invoke('browser_layout',{id:id.current,bounds:bounds(),visible:shown.current&&!!element.current?.offsetWidth})).catch(reason=>{if(!disposed)callbacks.current.onState('error',String(reason));});};
  ready.current=invoke('browser_open',{id:id.current,address:url,bounds:bounds(),events});void ready.current.then(layout).catch(reason=>{if(!disposed)callbacks.current.onState('error',String(reason));});
  controller.current=action=>ready.current.then(()=>invoke('browser_action',{id:id.current,action})).catch(reason=>callbacks.current.onState('error',String(reason)));
  const observer=new ResizeObserver(layout);observer.observe(element.current);window.addEventListener('resize',layout);
  return()=>{disposed=true;controller.current=null;observer.disconnect();window.removeEventListener('resize',layout);void ready.current?.then(()=>invoke('browser_action',{id:id.current,action:'close'})).catch(()=>{});};
 },[]);
 useEffect(()=>{if(last.current.url===url&&last.current.attempt===attempt)return;const action=last.current.url===url?'reload':'navigate';last.current={url,attempt};void ready.current?.then(()=>invoke('browser_action',{id:id.current,action,address:url})).catch(reason=>callbacks.current.onState('error',String(reason)));},[url,attempt]);
 useEffect(()=>{void ready.current?.then(()=>invoke('browser_layout',{id:id.current,bounds:bounds(),visible:visible&&!!element.current?.offsetWidth})).catch(()=>{});},[visible]);
 return <div ref={element} className="native-browser-surface" aria-label="独立网页视图"/>;
}
