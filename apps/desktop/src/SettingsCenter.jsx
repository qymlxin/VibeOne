import React,{useState} from 'react';
import {ArrowLeft,Settings2,Sun,Bell,Terminal,Folder,Plug,Globe,Database,Search} from 'lucide-react';
import {Brand} from './Brand.jsx';
import {Management} from './Management.jsx';
import {AgentSettings} from './AgentSettings.jsx';
import {PluginManager} from './plugins.jsx';
import {RemoteSettings} from './Remote.jsx';
import {NotificationSettings} from './NotificationSettings.jsx';
const groups=[['应用',['general','appearance','notifications']],['工作方式',['agents','workspaces','plugins']],['主机与设备',['remote','data']]];
const pages=[['general','常规',Settings2,'主机 历史 会话'],['appearance','外观',Sun,'主题 颜色'],['notifications','通知',Bell,'审批 提醒'],['agents','Agent',Terminal,'配置 启动'],['workspaces','工作区',Folder,'项目 目录'],['plugins','插件',Plug,'安装 更新 权限'],['remote','远程连接',Globe,'手机 配对 证书 设备'],['data','数据与诊断',Database,'存储 重启 导出']];
export function SettingsCenter({workbench,plugins,theme,setTheme,onBack,appearance,initialPage='general'}){
 const [page,setPage]=useState(initialPage),[query,setQuery]=useState('');
 const admin=!workbench.device;const available=pages.filter(([id])=>admin||['general','appearance','notifications'].includes(id));const visible=available.filter(([,title,,keywords])=>`${title} ${keywords}`.toLowerCase().includes(query.toLowerCase()));
 const [error,setError]=useState('');const run=async action=>{setError('');try{await action();}catch(error){setError(error.message);}};
 const title=available.find(([id])=>id===page)?.[1]??'常规';
 const busy=workbench.sessions.some(session=>['starting','running','requires_action','cancelling'].includes(session.status))||(workbench.operations??[]).some(operation=>['accepted','running'].includes(operation.state));
 return <div className="desktop-settings-center"><aside className="desktop-settings-navigation"><button className="desktop-text-action" onClick={onBack}><ArrowLeft size={14}/>返回工作台</button><h2>设置</h2><label><Search size={14}/><input aria-label="搜索设置" placeholder="搜索设置" value={query} onChange={event=>setQuery(event.target.value)}/></label><nav aria-label="设置分类">{groups.map(([label,ids])=>{const items=visible.filter(([id])=>ids.includes(id));return items.length?<section className="desktop-settings-nav-group" key={label}><p>{label}</p>{items.map(([id,label,Icon])=><button key={id} aria-current={page===id?'page':undefined} onClick={()=>setPage(id)}><Icon size={15}/>{label}</button>)}</section>:null;})}{!visible.length&&<p>没有匹配的设置</p>}</nav><footer><Brand/><small>{admin?'本机工作主机':`设备权限：${workbench.device.role}`}</small></footer></aside><div className="desktop-settings-page" key={page}><header><span>设置 / {title}</span></header><div className={`desktop-settings-content ${['agents','plugins'].includes(page)?'wide':''}`}><h1>{title}</h1>
 {page==='general'&&<><p>连接、会话与执行的基本行为。</p>
 <section className="desktop-settings-section"><h2>工作环境</h2><div className="desktop-settings-card">
 <div className="desktop-settings-row"><div><strong>工作主机</strong><p>桌面关闭后，独立主机继续保存会话并承载执行。</p></div><span className="desktop-connection-badge">{workbench.phase==='online'?'本机 · 已连接':workbench.phase}</span><button onClick={()=>void workbench.reconnect()}>重新连接</button></div>
 <div className="desktop-settings-row"><div><strong>Agent 接入</strong><p>已配置的启动入口。入口可用不等于工具已经认证。</p></div><span>{workbench.providers.map(provider=>provider.name).join('、')}</span>{admin&&<button onClick={()=>setPage('agents')}>管理 Agent</button>}</div>
 <div className="desktop-settings-row"><span>界面语言</span><span>简体中文</span></div></div></section>
 <section className="desktop-settings-section"><h2>会话与执行</h2><div className="desktop-settings-card">
 <div className="desktop-settings-row"><div><strong>本地历史</strong><p>会话和配置统一持久保存，工程文件保留原路径。</p></div><span>{workbench.persistent?'自动保存':'仅当前主机运行期间保留'}</span></div>
 <div className="desktop-settings-row"><div><strong>重启后的历史会话</strong><p>保留原消息；继续时明确选择原上下文或新上下文。</p></div><span>不自动重放审批</span></div>
 <div className="desktop-settings-row"><div><strong>同一会话执行</strong><p>同一会话串行执行；可入队、撤回和暂停排队消息。</p></div><span>最多 20 条排队消息</span></div>
 {admin&&<div className="desktop-settings-row"><div><strong>数据目录</strong><p>无法写入主目录时，使用可写的兼容目录。</p></div><code>{workbench.dataDirectory??'由主机管理'}</code><button onClick={()=>setPage('data')}>查看数据详情</button></div>}</div></section>
 <p className="desktop-settings-note">会话保存在本机。修改连接或启动配置不会自动开始执行任务。</p>{!admin&&<p>设备角色及工作区范围由电脑端管理。</p>}</>}
 {page==='appearance'&&(appearance??<section className="desktop-settings-group"><h2>视觉风格</h2><div className="desktop-settings-row"><span>模式</span><select aria-label="外观模式" value={theme} onChange={event=>setTheme(event.target.value)}><option value="system">跟随系统</option><option value="light">亮色</option><option value="dark">暗色</option></select></div></section>)}
 {page==='notifications'&&<NotificationSettings/>}
 {page==='agents'&&admin&&<AgentSettings workbench={workbench}/>}
 {page==='workspaces'&&admin&&<><p>已有工程保持原目录。未选目录的新会话会创建托管项目。</p><Management workbench={workbench} section="workspaces"/><section className="desktop-settings-group"><h2>托管项目</h2><p>位于统一数据目录的 projects 子目录；与已有工作区分别管理。同一 Git Worktree 的并发执行受到租约保护。</p></section></>}
 {page==='plugins'&&admin&&<PluginManager workbench={workbench} plugins={plugins}/>}
 {page==='remote'&&admin&&<RemoteSettings workbench={workbench}/>}
 {page==='data'&&admin&&<><section className="desktop-settings-group"><h2>本地存储</h2><div className="desktop-settings-row"><span>统一数据目录</span><code>{workbench.dataDirectory??'由主机管理'}</code></div><p>{workbench.persistent?'会话、配置和设备保存在本机 SQLite；工程文件保持原路径。':'当前主机尚未启用持久历史。'}</p>{workbench.migrationPending&&<p>有任务使用旧目录，空闲重启后迁移。</p>}{workbench.migrationWarning&&<p role="status">{workbench.migrationWarning}</p>}</section><section className="desktop-settings-group"><h2>工作主机</h2><div className="desktop-settings-row"><div><strong>重启工作主机</strong><p>先结束全部执行；重启后保留会话，未恢复的上下文需明确继续。</p></div><button disabled={workbench.phase!=='online'||busy} onClick={()=>void run(workbench.restart)}>{workbench.phase==='upgrading'?'正在重启…':workbench.persistent?'重启工作主机':'保存会话并升级主机'}</button></div></section><Management workbench={workbench} section="diagnostics"/><section className="desktop-settings-group"><h2>通信信息</h2><div className="desktop-settings-row"><span>Agent</span><code>ACP v2</code></div><div className="desktop-settings-row"><span>插件</span><code>Plugin RPC v1</code></div></section></>}
 {error&&<p role="alert">{error}</p>}
 </div></div></div>;
}
