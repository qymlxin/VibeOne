import './electron-desktop.css';
export const invoke=(command,args={})=>{
 if(!window.vibeoneDesktop)return Promise.reject(new Error('此功能需要在桌面应用中使用'));
 return window.vibeoneDesktop.invoke(command,args.events?{...args,events:{channel:args.events.id}}:args);
};
export class Channel {
 constructor(){this.id=crypto.randomUUID();}
 toJSON(){return {channel:this.id};}
}
export function streamChannel(){
 const events=new Channel();
 const dispose=window.vibeoneDesktop?.onChannel(events.id,event=>events.onmessage?.(event))??(()=>{});
 return {events,dispose};
}
if(typeof window!=='undefined'&&window.vibeoneDesktop)document.documentElement.classList.add('electron-desktop');
