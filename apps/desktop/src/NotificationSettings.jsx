import React,{useCallback,useEffect,useRef,useState} from 'react';
import {enableNotifications,notificationPermission,canNotify} from './notifications.js';
const labels={granted:'已授权',denied:'未授权，请检查系统设置',default:'尚未请求',provisional:'已临时授权',ephemeral:'已临时授权',unsupported:'当前浏览器不支持通知',unavailable:'当前平台未提供系统权限查询',unknown:'系统返回未知权限状态'};
export function NotificationSettings(){
  const [enabled,setEnabled]=useState(()=>{try{return localStorage.getItem('vibeone-notifications')==='enabled';}catch{return false;}});
  const [permission,setPermission]=useState(null),[busy,setBusy]=useState(false),[checking,setChecking]=useState(false),[error,setError]=useState(''),[readError,setReadError]=useState('');
  const epoch=useRef(0),mounted=useRef(true);
  const refresh=useCallback(async()=>{
    const current=++epoch.current;setChecking(true);setReadError('');
    try{const result=await notificationPermission();if(mounted.current&&current===epoch.current)setPermission(result);}
    catch(error){if(mounted.current&&current===epoch.current){setPermission(null);setReadError(String(error.message??error));}}
    finally{if(mounted.current&&current===epoch.current)setChecking(false);}
  },[]);
  useEffect(()=>{mounted.current=true;void refresh();const focus=()=>void refresh();window.addEventListener('focus',focus);return()=>{mounted.current=false;epoch.current++;window.removeEventListener('focus',focus);};},[refresh]);
  async function toggle(){
    setBusy(true);setError('');
    try{
      if(enabled){localStorage.removeItem('vibeone-notifications');if(mounted.current)setEnabled(false);}
      else{await enableNotifications();if(mounted.current)setEnabled(true);}
    }catch(error){if(mounted.current)setError(String(error.message??error));}
    finally{if(mounted.current){setBusy(false);void refresh();}}
  }
  return <>
    <section className="desktop-settings-group"><h2>桌面通知</h2>
      <div className="desktop-settings-row"><div><strong>审批与执行结束提醒</strong><p>开启时请求通知权限。关闭只停止本设备发送提醒。</p></div><button role="switch" aria-label="桌面通知" aria-checked={enabled} disabled={busy} onClick={()=>void toggle()}>{busy?'正在更新…':enabled?'已开启':'开启通知'}</button></div>
      <div className="desktop-settings-row"><div><strong>系统权限</strong><p>与本设备的提醒开关独立；系统更改后可刷新状态。</p></div><span role="status">{checking?'正在查询…':permission?labels[permission.status]??labels.unknown:'无法读取权限状态'}</span><button type="button" disabled={checking||busy} onClick={()=>void refresh()}>刷新通知权限</button></div>
      {enabled&&permission&&!canNotify(permission.status)&&<p role="status">提醒开关已开启，但{permission.status==='unavailable'?'是否弹出仍由系统设置决定。':'当前没有可用的通知授权。'}</p>}
      {(error||readError)&&<p role="alert">{[error,readError].filter(Boolean).join('；')}</p>}
    </section>
    <section className="desktop-settings-group"><h2>通知事件</h2><p>新出现的权限审批、补充输入和执行结束会触发提醒。首次连接只建立历史基线，不补发此前的执行记录。插件通知渠道继续在插件页管理。</p></section>
  </>;
}
