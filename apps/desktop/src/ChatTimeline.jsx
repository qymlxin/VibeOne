import {AttachmentCards} from './Attachments.jsx';
import React, {memo, useContext, useEffect, useMemo, useRef, useState} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {BookOpen, Brain, Check, Copy, ChevronDown, ChevronRight, ExternalLink, GitCompareArrows, FileText, LoaderCircle, MessageSquare, Search, Terminal, Wrench, X} from 'lucide-react';
import {activityTail, formatDuration, groupProcess, toolFamily} from './chat-timeline.js';
import {ToolDetails} from './ToolDetails.jsx';
import {describeAction,describeTool} from './tool-presentation.js';
import {PreviewContext,PreviewLink,markdownLink} from './PreviewLinks.jsx';
import {workspacePath} from './preview-links.js';
import {remarkSoftBreaks} from './markdown-layout.js';

const markdownComponents = {
  a: PreviewLink,
  img: props => <span>[图片：{props.alt ?? '图片'}]</span>,
};
const MarkdownBody=memo(function MarkdownBody({text}) {
  return <div className="assistant-message desktop-message-text"><ReactMarkdown urlTransform={markdownLink} remarkPlugins={[remarkGfm,remarkSoftBreaks]} components={markdownComponents}>{text || '…'}</ReactMarkdown></div>;
});
const Truncated=({item})=>item?.textTruncated?<p className="desktop-history-notice">此条正文超过显示上限，仅保留前 65,536 个字符。</p>:null;
export const ChatMessage = memo(function ChatMessage({message,name}) {
  const user=message.role==='user';
  return user?<article className="user-message desktop-message user" data-history-order={message.historyOrder}><AttachmentCards items={message.attachments}/>{(message.text||!message.attachments?.length)&&<p className="desktop-message-text">{message.text||'…'}</p>}{message.pending&&<small>已受理 · 等待 Agent 接受</small>}<Truncated item={message}/></article>:<article className={`desktop-message ${message.role}`} data-history-order={message.historyOrder}><MarkdownBody text={message.text}/><Truncated item={message}/></article>;
},(a,b)=>a.name===b.name && a.message.id===b.message.id && a.message.text===b.message.text && a.message.attachments===b.message.attachments && a.message.pending===b.message.pending && a.message.role===b.message.role && a.message.historyOrder===b.message.historyOrder && a.message.textTruncated===b.message.textTruncated);

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
  return <details className={`desktop-activity-item ${type}`} data-history-order={item.historyOrder} onToggle={event=>{
    setOpen(event.currentTarget.open);if(event.currentTarget.open)onInspect();
  }}>
    <summary><span className="desktop-process-item-icon"><Icon size={13}/></span><span title={type==='tool'?(describeAction(item).paths.join('\n') || toolTitle(item)):undefined}>{type==='tool'?toolTitle(item):activityTail(text)}</span><span>{type==='tool'?(toolStatus[item.status] ?? item.status ?? '处理中'):'思考摘要'}</span><ChevronDown size={12}/></summary>
    {open && (type==='tool' ? <ToolDetails tool={item}/> : <div className="desktop-process-thought"><MarkdownBody text={text}/><Truncated item={item}/></div>)}
  </details>;
}
function ReadFiles({activity,onInspect}) {
  const preview=useContext(PreviewContext);
  const {item}=activity,action=describeAction(item);
  if(!action.paths.length||['failed','cancelled'].includes(item.status))return <ActivityItem activity={activity} onInspect={onInspect}/>;
  return <div className="desktop-read-files" data-history-order={item.historyOrder}>{action.paths.map(path=>{
    const relative=workspacePath(path,preview?.workspace);
    const name=path.split(/[\\/]/).at(-1);
    return <button key={path} className="event-file" title={relative?path:`${path} · 不在当前工作区，无法预览`} disabled={!relative||!preview} onClick={()=>{onInspect();preview.openFile(relative);}}><BookOpen size={14}/>{action.label}<span>{name}</span><ExternalLink size={12}/></button>;
  })}</div>;
}
function ToolGroup({group,onInspect}) {
  const Icon=familyIcon[group.family];
  const failed=group.items.some(activity=>activity.item.status==='failed');
  const working=group.items.some(activity=>['pending','in_progress'].includes(activity.item.status));
  const completed=group.items.every(activity=>activity.item.status==='completed');
  const count=new Set(group.items.flatMap(activity=>describeAction(activity.item).paths)).size;
  const label=completed?({read:count?`已读取 ${count} 个文件`:'已读取文件',command:'已运行命令',file:'已处理文件',web:'已搜索与浏览网页'}[group.family] ?? familyLabel[group.family]):familyLabel[group.family];
  return <details className="event-group desktop-tool-group" data-history-order={group.items[0]?.item.historyOrder} onToggle={event=>{if(event.currentTarget.open)onInspect();}}>
    <summary><Icon size={16}/>{label}{(failed||working)&&<small>{failed?'含失败':'执行中'}</small>}<ChevronRight size={14}/></summary>
    <div className={group.family==='read'?'event-files':'desktop-tool-group-body'}>{group.items.map(activity=>group.family==='read'?<ReadFiles key={activity.id} activity={activity} onInspect={onInspect}/>:<ActivityItem key={activity.id} activity={activity} onInspect={onInspect}/>)}</div>
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
  const label=turn.id==='legacy-tools'?'早期工具记录（轮次未知）':live?({starting:'正在准备',requires_action:hasInput?'等待补充信息':'等待审批',cancelling:'正在停止'}[status] ?? runningLabel):({completed:'已处理',cancelled:'已停止',failed:'处理未完成',interrupted:'已中断'}[run?.status] ?? '处理记录');
  const elapsed=Math.max(0,Math.floor(((live?tick:run?.finishedAt ?? tick)-(run?.startedAt ?? mountedAt))/1000));
  const latestThought=preview.findLast(item=>item.type==='thought')?.id;
  const StatusElement=activity.length?'button':'div';
  return <section className="desktop-activity" aria-label="Agent 处理过程" data-live={live}>
    <StatusElement className="turn-status desktop-activity-toggle" type={activity.length?"button":undefined} aria-label={activity.length?`${label}，${expanded?'收起过程':'查看过程'}`:undefined} aria-expanded={activity.length?expanded:undefined} onClick={activity.length?()=>{setExpanded(value=>!value);if(!expanded)onReadHistory();}:undefined}>
      {live&&<LoaderCircle className="desktop-spin" size={13} aria-hidden="true"/>}
      <span ref={motionTarget} role={live?'status':undefined} className={motion?'thinking-shimmer':''}>{label}</span>
      {(live || run?.finishedAt) && <time>{formatDuration(elapsed)}</time>}
      {activity.length>0 && <ChevronRight size={13} className={expanded?'expanded':''}/>}
    </StatusElement>
    {!expanded && live && <div className="desktop-activity-preview" aria-label="最新处理动态">
      {preview.map(item=><div key={item.id} className={`desktop-activity-preview-row ${item.type}`}><span>{typeLabel[item.type]}</span><span className={motion && item.id===latestThought?'thinking-shimmer':''}>{activityTail(item.text) || '正在接收摘要…'}</span>{item.type==='tool' && <span>{toolStatus[item.item.status] ?? item.item.status}</span>}</div>)}
      {!preview.length && <div className="desktop-live-status"><span>{hasInput?'等待你处理下方请求后继续。':turn.answer?.text?'正在接收回复':'Agent 正在处理，等待输出'}</span>{!hasInput && status==='running' && !turn.answer?.text && elapsed>=3 && <small>尚未收到可展示的思考摘要；收到后会自动显示。</small>}</div>}
    </div>}
    {expanded && <div className="desktop-activity-history">
      {groups.map(group=>group.type==='tools'?<ToolGroup key={group.id} group={group} onInspect={onReadHistory}/>:group.type==='note'?<div key={group.id} className="desktop-process-note" data-history-order={group.event.item.historyOrder}>{group.event.unknownRole&&<small>历史消息（角色未记录）</small>}<MarkdownBody text={group.event.text}/><Truncated item={group.event.item}/></div>:<ActivityItem key={group.id} activity={group.event} onInspect={onReadHistory}/>)}
    </div>}
  </section>;
}

function AnswerActions({text,name}) {
  const [state,setState]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>setState(''),[text]);
  return <div className="message-actions desktop-answer-actions"><button type="button" aria-label="复制回答" disabled={busy} onClick={async()=>{setBusy(true);try{if(!navigator.clipboard?.writeText)throw Error('当前环境不支持剪贴板');await navigator.clipboard.writeText(text);setState('已复制');}catch{setState('复制失败，请选择正文复制');}finally{setBusy(false);}}}><Copy size={13}/></button><span>{name}</span>{state&&<span role="status">{state}</span>}</div>;
}
export function AgentResponse({turn,name,status,hasInput,onReadHistory,onChanges,changeCount}) {
  if (!turn.process.length && !turn.answer && !turn.live && !turn.run?.finishedAt) return null;
  return <section className="assistant-message desktop-agent-turn" aria-label={`${name} 的回复`}>
    <ActivityFeed turn={{...turn,activity:turn.process}} status={status} hasInput={hasInput} onReadHistory={onReadHistory}/>
    {turn.answer && <article className="desktop-message assistant desktop-agent-reply" data-history-order={turn.answer.historyOrder}><div><MarkdownBody text={turn.answer.text}/><Truncated item={turn.answer}/></div></article>}
    {changeCount>0&&!turn.live&&<button className="change-summary" onClick={onChanges}><GitCompareArrows size={16}/><div><strong>查看工作区当前变更</strong><span>{changeCount} 个文件 · 包含用户和其他工具的修改</span></div><ChevronRight size={15}/></button>}
    {turn.answer&&!turn.live&&<AnswerActions text={turn.answer.text} name={name}/>}

  </section>;
}
