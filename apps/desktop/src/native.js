import './electron-desktop.css';
import {invoke as tauriInvoke,Channel as TauriChannel} from '@tauri-apps/api/core';
export const invoke=(command,args={})=>window.vibeoneDesktop?window.vibeoneDesktop.invoke(command,args.events?{...args,events:{channel:args.events.id}}:args):tauriInvoke(command,args);
export class Channel {
 constructor(){if(!window.vibeoneDesktop)return new TauriChannel();this.id=crypto.randomUUID();}
 toJSON(){return {channel:this.id};}
}
export function streamChannel(){
 if(!window.vibeoneDesktop)return {events:new TauriChannel(),dispose:()=>{}};
 const events=new Channel();const dispose=window.vibeoneDesktop.onChannel(events.id,event=>events.onmessage?.(event));return {events,dispose};
}

if(typeof window!=='undefined'&&window.vibeoneDesktop)document.documentElement.classList.add('electron-desktop');
