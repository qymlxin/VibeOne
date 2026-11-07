import React from 'react';
import {Plug} from 'lucide-react';
import {SettingsGroup,SettingsRow,SettingsSwitch} from './SettingsRows.jsx';
const extensionNames={'app.panel':'工作区面板','app.command':'命令','settings.section':'设置','agent.provider':'Agent Provider','notification.channel':'事件通知'};
const kinds=(contributions,app)=>[...new Set(contributions.filter(item=>app?item.binding?.type==='app':item.binding?.type==='worker').map(item=>extensionNames[item.kind]??item.kind))];

export function PluginDetails({plugin,workspaces,busy,onDisable,onEnable,onConfigure,onInvoke,children}){
 const contributions=plugin.manifest?.contributions??[];
 const scopes=(plugin.workspaces??[]).map(id=>({id,name:workspaces.find(item=>item.id===id)?.name??id}));
 const commands=contributions.filter(item=>item.kind==='app.command'&&item.binding?.type==='worker');
 return <article className="desktop-plugin-detail" aria-label={`插件详情 ${plugin.name??plugin.id}`}>
  <header className="object-heading desktop-settings-object-heading"><span className="provider-symbol desktop-provider-symbol large"><Plug size={22}/></span><div><h2>{plugin.name??plugin.id}</h2><p>{plugin.manifest?.description??`版本 ${plugin.version} · ${plugin.id}`}</p></div></header>
  {plugin.error&&<p role="alert">{plugin.error}</p>}
  <SettingsGroup title="运行状态">
   <SettingsRow title="启用插件" description="停用后不再接收新的业务调用；已有会话的代次租约继续排空。"><SettingsSwitch label="启用插件" checked={!!plugin.enabled} disabled={busy} onChange={enabled=>enabled?onEnable():onDisable()}/></SettingsRow>
   <SettingsRow title="当前代次"><code className="settings-badge desktop-settings-badge">generation {plugin.generation}</code></SettingsRow>
  </SettingsGroup>
  <SettingsGroup title="权限与贡献">
   <SettingsRow title="已授权工作区"><span className="desktop-plugin-scopes">{scopes.length?scopes.map(scope=><span className="settings-badge desktop-settings-badge" key={scope.id}>{scope.name}</span>):'尚未授权工作区'}</span></SettingsRow>
   <SettingsRow title="应用扩展"><span>{kinds(contributions,true).join(' · ')||'无'}</span></SettingsRow>
   <SettingsRow title="后台扩展"><span>{kinds(contributions,false).join(' · ')||'无'}</span></SettingsRow>
   {!!plugin.capabilities?.length&&<SettingsRow title="声明能力"><span>{plugin.capabilities.join(' · ')}</span></SettingsRow>}
  </SettingsGroup>
  <div className="desktop-plugin-reconfigure"><p>{plugin.enabled?'更新前检查候选版本；候选失败时保留旧版本。修改配置或授权范围后需重新检查。':'可直接启用已授权的安装版本，或重新配置。'}</p><button type="button" disabled={busy} onClick={onConfigure}>重新配置 / 启用</button></div>
  {plugin.enabled&&commands.length>0&&<SettingsGroup title="后台命令">{commands.map(item=><SettingsRow key={item.id} title={item.title??item.id}><button disabled={busy} onClick={()=>onInvoke(item)}>{item.title??item.id}</button></SettingsRow>)}</SettingsGroup>}
  {children}
 </article>;
}
