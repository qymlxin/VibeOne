import React, {memo, useEffect, useMemo, useRef, useState} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {BookOpen, Brain, Check, ChevronDown, FileText, LoaderCircle, MessageSquare, Search, Terminal, Wrench, X} from 'lucide-react';
import {activityTail, formatDuration, groupProcess, toolFamily} from './chat-timeline.js';
import {ToolDetails} from './ToolDetails.jsx';
import {describeAction,describeTool} from './tool-presentation.js';
import {remarkSoftBreaks} from './markdown-layout.js';

const markdownComponents = {
  a: props => <a {...props} target="_blank" rel="noopener noreferrer"/>,
  img: props => <span>[图片：{props.alt ?? '图片'}]</span>,
};
const MarkdownBody=memo(function MarkdownBody({text}) {
  return <div className="desktop-message-text"><ReactMarkdown remarkPlugins={[remarkGfm,remarkSoftBreaks]} components={markdownComponents}>{text || '…'}</ReactMarkdown></div>;
});
export const ChatMessage = memo(function ChatMessage({message,name}) {
  const user=message.role==='user';
  return <article className={`desktop-message ${message.role}`}>
    <span className="desktop-avatar">{user ? '你' : <MessageSquare size={14}/>}</span>
    <div><div className="desktop-message-meta"><strong>{user ? '你' : name}</strong>{message.pending && <span>已受理 · 等待 Agent 接受</span>}</div>
      {user ? <div className="desktop-message-text">{message.text || '…'}</div> : <MarkdownBody text={message.text}/>}
    </div>
  </article>;
},(a,b)=>a.name===b.name && a.message.id===b.message.id && a.message.text===b.message.text && a.message.pending===b.message.pending && a.message.role===b.message.role);

const toolStatus = {pending:'等待执行',in_progress:'执行中',completed:'已完成',failed:'失败',cancelled:'已停止'};
const typeLabel = {thought:'思考摘要',tool:'工具',note:'说明'};
const familyLabel={read:'读取文件',web:'搜索与浏览网页',command:'运行命令',file:'文件操作',other:'工具调用'};
const familyIcon={read:BookOpen,web:Search,command:Terminal,file:FileText,other:Wrench};
function toolTitle(tool) {
  const action=describeAction(tool);
  if(action.label && action.paths.length)return `${action.label} ${action.paths.map(path=>path.split(/[\\/]/).at(-1)).join('、')}`;
  const {kind,fields}=describeTool(tool);
  const value=fields[0]?.value;
  if (kind==='search' && Array.isArray(value)) return `搜索：${value.join('、')}`;
  if (kind==='web' && typeof value==='string') return `${fields.some(field=>field.label==='查找内容')?'查找网页':'打开网页'}：${value}`;
  if (kind==='command' && typeof value==='string') return `运行：${value.split('\n')[0]}`;
  if (kind==='file' && typeof value==='string') return `文件：${value}`;
  return tool.title ?? tool.name ?? '工具调用';
}
function ActivityItem({activity,onInspect}) {
  const [open,setOpen]=useState(false);
  const {item,type,text}=activity;
  const Icon=type==='thought'?Brain:familyIcon[toolFamily(item)];
  return <details className={`desktop-activity-item ${type}`} onToggle={event=>{
    setOpen(event.currentTarget.open);if(event.currentTarget.open)onInspect();
  }}>
    <summary><span className="desktop-process-item-icon"><Icon size={13}/></span><span title={type==='tool'?(describeAction(item).paths.join('\n') || toolTitle(item)):undefined}>{type==='tool'?toolTitle(item):activityTail(text)}</span><span>{type==='tool'?(toolStatus[item.status] ?? item.status ?? '处理中'):'思考摘要'}</span><ChevronDown size={12}/></summary>
    {open && (type==='tool' ? <ToolDetails tool={item}/> : <div className="desktop-process-thought"><MarkdownBody text={text}/></div>)}
  </details>;
}
function ToolGroup({group,onInspect}) {
  const Icon=familyIcon[group.family];
  const failed=group.items.some(activity=>activity.item.status==='failed');
  const working=group.items.some(activity=>['pending','in_progress'].includes(activity.item.status));
  const completed=group.items.filter(activity=>activity.item.status==='completed').length;
  const label=completed===group.items.length?({read:'已读取文件',command:'已运行命令',file:'已处理文件',web:'已搜索与浏览网页'}[group.family] ?? familyLabel[group.family]):familyLabel[group.family];
  return <details className="desktop-tool-group" onToggle={event=>{if(event.currentTarget.open)onInspect();}}>
    <summary><Icon size={13}/><span>{label}</span><span>{group.items.length} 项</span><span>{failed?'含失败':working?'执行中':completed===group.items.length?'已完成':''}</span><ChevronDown size={12}/></summary>
    <div className="desktop-tool-group-body">{group.items.map(activity=><ActivityItem key={activity.id} activity={activity} onInspect={onInspect}/>)}</div>
  </details>;
}
function useVisibleMotion(ref,enabled) {
  const [allowed,setAllowed]=useState(false);
  useEffect(()=>{
    if (!enabled) return;
    let visible=typeof IntersectionObserver==='undefined',disposed=false;
    const update=()=>{if(!disposed)setAllowed(visible && document.visibilityState!=='hidden');};
    const observer=typeof IntersectionObserver==='undefined'?null:new IntersectionObserver(entries=>{visible=entries.some(entry=>entry.isIntersecting);update();});
    if(ref.current)observer?.observe(ref.current);
    document.addEventListener('visibilitychange',update);update();
    return ()=>{disposed=true;observer?.disconnect();document.removeEventListener('visibilitychange',update);};
  },[enabled,ref]);
  return enabled && allowed;
}

export function ActivityFeed({turn,status,hasInput,onReadHistory}) {
  const [expanded,setExpanded]=useState(false);
  const [tick,setTick]=useState(Date.now);
  const [mountedAt]=useState(Date.now);
  const motionTarget=useRef(null);
  const {activity,live,run}=turn;
  const motion=useVisibleMotion(motionTarget,live && !['requires_action','cancelling'].includes(status));
  const groups=useMemo(()=>groupProcess(activity),[activity]);
  useEffect(()=>{
    if (!live) return;
    setTick(Date.now());
    const timer=setInterval(()=>setTick(Date.now()),1000);
    return ()=>clearInterval(timer);
  },[live]);
  if (!activity.length && !live && !run?.finishedAt) return null;
  const preview=[...activity].sort((a,b)=>(a.item.updatedOrder ?? a.item.activityOrder ?? 0)-(b.item.updatedOrder ?? b.item.activityOrder ?? 0)).slice(-3);
  const last=preview.at(-1);
  const runningLabel=last?.type==='thought'?'思考中':last?.type==='tool' && ['in_progress','pending'].includes(last.item.status)?'正在执行':turn.answer?.text?'正在回复':'正在处理';
  const label=turn.id==='legacy-tools'?'早期工具记录（轮次未知）':live?({starting:'正在准备',requires_action:hasInput?'等待补充信息':'等待审批',cancelling:'正在停止'}[status] ?? runningLabel):({completed:'已完成',cancelled:'已停止',failed:'处理未完成',interrupted:'已中断'}[run?.status] ?? '处理记录');
  const elapsed=Math.max(0,Math.floor(((live?tick:run?.finishedAt ?? tick)-(run?.startedAt ?? mountedAt))/1000));
  const latestThought=preview.findLast(item=>item.type==='thought')?.id;
  return <section className="desktop-activity" aria-label="Agent 处理过程" data-live={live}>
    <button className="desktop-activity-toggle" type="button" disabled={!activity.length} aria-expanded={activity.length?expanded:undefined} onClick={()=>{setExpanded(value=>!value);if(!expanded)onReadHistory();}}>
      {live ? <LoaderCircle className="desktop-spin" size={13} aria-hidden="true"/> : run?.status==='completed'?<Check size={13} aria-hidden="true"/>:run?.status==='failed'?<X size={13} aria-hidden="true"/>:<Terminal size={13} aria-hidden="true"/>}
      <span ref={motionTarget} role={live?'status':undefined} className={motion?'thinking-shimmer':''}>{label}</span>
      {(live || run?.finishedAt) && <time>{formatDuration(elapsed)}</time>}
      {activity.length>0 && <><span className="desktop-activity-count">{activity.length} 项过程</span><span>{expanded?'收起过程':'查看过程'}</span><ChevronDown size={13} className={expanded?'expanded':''}/></>}
    </button>
    {!expanded && live && <div className="desktop-activity-preview" aria-label="最新处理动态">
      {preview.map(item=><div key={item.id} className={`desktop-activity-preview-row ${item.type}`}><span>{typeLabel[item.type]}</span><span className={motion && item.id===latestThought?'thinking-shimmer':''}>{activityTail(item.text) || '正在接收摘要…'}</span>{item.type==='tool' && <span>{toolStatus[item.item.status] ?? item.item.status}</span>}</div>)}
      {!preview.length && <div className="desktop-live-status"><span>{turn.answer?.text?'正在接收回复':'Agent 正在处理，等待输出'}</span>{status==='running' && !turn.answer?.text && elapsed>=3 && <small>尚未收到可展示的思考摘要；收到后会自动显示。</small>}</div>}
    </div>}
    {expanded && <div className="desktop-activity-history">
      {groups.map(group=>group.type==='tools'?<ToolGroup key={group.id} group={group} onInspect={onReadHistory}/>:group.type==='note'?<div key={group.id} className="desktop-process-note"><MarkdownBody text={group.event.text}/></div>:<ActivityItem key={group.id} activity={group.event} onInspect={onReadHistory}/>)}
    </div>}
  </section>;
}

export function AgentResponse({turn,name,status,hasInput,onReadHistory}) {
  if (!turn.process.length && !turn.answer && !turn.live && !turn.run?.finishedAt) return null;
  return <section className="desktop-agent-turn" aria-label={`${name} 的回复`}>
    <div className="desktop-agent-identity"><span className="desktop-avatar"><MessageSquare size={14}/></span><strong>{name}</strong></div>
    <ActivityFeed turn={{...turn,activity:turn.process}} status={status} hasInput={hasInput} onReadHistory={onReadHistory}/>
    {turn.answer && <article className="desktop-message assistant desktop-agent-reply"><div><MarkdownBody text={turn.answer.text}/></div></article>}
  </section>;
}
