const {contextBridge,ipcRenderer}=require('electron');
const commands=new Set(['project_details','host_connection','restart_host','choose_workspace','open_external','export_remote_certificate','notification_permission','request_notification_permission','desktop_notify','terminal_open','terminal_write','terminal_resize','terminal_close','browser_open','browser_layout','browser_action']);
contextBridge.exposeInMainWorld('vibeoneDesktop',Object.freeze({
 invoke(command,args={}){if(!commands.has(command))return Promise.reject(Error('未知桌面命令'));return ipcRenderer.invoke('vibeone:command',command,args);},
 onChannel(id,callback){const listener=(_event,message)=>{if(message.id===id)callback(message.event);};ipcRenderer.on('vibeone:channel',listener);return()=>ipcRenderer.removeListener('vibeone:channel',listener);}
}));
