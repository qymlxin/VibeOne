import React, {memo, useEffect, useLayoutEffect, useRef, useState} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {Check, ChevronDown, LoaderCircle, MessageSquare, Terminal, X} from 'lucide-react';
import {activityTail} from './chat-timeline.js';
import {ToolDetails} from './ToolDetails.jsx';

const markdownComponents = {
  a: props => <a {...props} target="_blank" rel="noopener noreferrer"/>,
  img: props => <span>[图片：{props.alt ?? '图片'}]</span>,
};
export const ChatMessage = memo(function ChatMessage({message,name}) {
  const user=message.role==='user';
  return <article className={`desktop-message ${message.role}`}>
    <span className="desktop-avatar">{user ? '你' : <MessageSquare size={14}/>}</span>
    <div><div className="desktop-message-meta"><strong>{user ? '你' : name}</strong>{message.pending && <span>已受理 · 等待 Agent 接受</span>}</div>
      <div className="desktop-message-text">{user ? message.text || '…' : <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{message.text || '…'}</ReactMarkdown>}</div>
    </div>
  </article>;
},(a,b)=>a.name===b.name && a.message.id===b.message.id && a.message.text===b.message.text && a.message.pending===b.message.pending && a.message.role===b.message.role);

const toolStatus = {pending:'等待执行',in_progress:'执行中',completed:'已完成',failed:'失败',cancelled:'已停止'};
const typeLabel = {thought:'思考摘要',tool:'工具',note:'Agent 消息'};
function ActivityItem({activity,onInspect}) {
  const {item,type,text}=activity;
  return <details className={`desktop-activity-item ${type}`} onToggle={event=>{if(event.currentTarget.open)onInspect();}}>
    <summary><span>{typeLabel[type]}</span><span>{activityTail(text)}</span>{type==='tool' && <span>{toolStatus[item.status] ?? item.status ?? '处理中'}</span>}<ChevronDown size={12}/></summary>
    {type==='tool' ? <ToolDetails tool={item}/> : <pre className="desktop-activity-detail">{text}</pre>}
  </details>;
}

export function ActivityFeed({turn,status,hasInput,onReadHistory}) {
  const [expanded,setExpanded]=useState(false);
  const [tick,setTick]=useState(Date.now);
  const [mountedAt]=useState(Date.now);
  const body=useRef(null), follow=useRef(true);
  const {activity,live,run}=turn;
  useEffect(()=>{
    if (!live) return;
    setTick(Date.now());
    const timer=setInterval(()=>setTick(Date.now()),1000);
    return ()=>clearInterval(timer);
  },[live]);
  const revision=activity.map(a=>`${a.id}:${a.item.updatedOrder ?? ''}:${a.text?.length ?? 0}:${a.item.status ?? ''}:${a.item.output?.length ?? 0}`).join('|');
  useLayoutEffect(()=>{
    if (expanded && follow.current && body.current) body.current.scrollTop=body.current.scrollHeight;
  },[revision,expanded]);
  if (!activity.length && !live) return null;
  const label=turn.id==='legacy-tools' ? '早期工具记录（轮次未知）' : live ? ({starting:'正在准备',requires_action:hasInput?'等待补充信息':'等待审批',cancelling:'正在停止'}[status] ?? '正在处理') : ({completed:'处理完成',cancelled:'已停止',failed:'处理未完成',interrupted:'已中断'}[run?.status] ?? '处理记录');
  const elapsed=Math.max(0,Math.floor(((live?tick:run?.finishedAt ?? tick)-(run?.startedAt ?? mountedAt))/1000));
  const preview=[...activity].sort((a,b)=>(a.item.updatedOrder ?? a.item.activityOrder ?? 0)-(b.item.updatedOrder ?? b.item.activityOrder ?? 0)).slice(-3);
  return <section className="desktop-activity" aria-label="Agent 处理过程" data-live={live}>
    <button className="desktop-activity-toggle" type="button" aria-expanded={expanded} onClick={()=>{setExpanded(value=>!value);if(!expanded && !live)onReadHistory();}}>
      {live ? <LoaderCircle className="desktop-spin" size={13} aria-hidden="true"/> : run?.status==='completed' ? <Check size={13} aria-hidden="true"/> : run?.status==='failed' ? <X size={13} aria-hidden="true"/> : <Terminal size={13} aria-hidden="true"/>}
      <span role={live?'status':undefined}>{label}</span>
      {activity.length>0 && <span className="desktop-activity-count">{activity.length} 项活动</span>}
      {(live || run?.finishedAt) && <time>{elapsed} 秒</time>}
      <span>{expanded?'收起过程':'查看过程'}</span><ChevronDown size={13} className={expanded?'expanded':''}/>
    </button>
    {!expanded && live && <div className="desktop-activity-preview" aria-label="最新处理动态">
      {preview.map(a=><div key={a.id} className={`desktop-activity-preview-row ${a.type}`}><span>{typeLabel[a.type]}</span><span>{activityTail(a.text) || '正在接收摘要…'}</span>{a.type==='tool' && <span>{toolStatus[a.item.status] ?? a.item.status}</span>}</div>)}
      {!preview.length && <div className="desktop-live-status"><span>{label==='正在处理'?(turn.reply?.text?'Agent 正在处理':'Agent 正在处理，等待输出'):label}</span>{status==='running' && !turn.reply?.text && elapsed>=3 && <small>尚未收到可展示的思考摘要；收到后会自动显示。</small>}</div>}
    </div>}
    {expanded && <div className="desktop-activity-history" ref={body} onScroll={event=>{
      const element=event.currentTarget;follow.current=element.scrollHeight-element.scrollTop-element.clientHeight<40;if(!follow.current)onReadHistory();
    }}>
      {activity.map(a=><ActivityItem key={a.id} activity={a} onInspect={()=>{follow.current=false;onReadHistory();}}/>)}
      {!activity.length && <p>Agent 尚未返回处理详情。</p>}
    </div>}
  </section>;
}
