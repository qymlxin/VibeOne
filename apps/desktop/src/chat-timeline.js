import {describeAction,describeTool} from './tool-presentation.js';

export const isRunActive = status => ['starting', 'running', 'requires_action', 'cancelling'].includes(status);

// Group by durable Run identity. Older records without identity retain message order;
// unassigned legacy tools stay separate rather than being attributed to a new turn.
export function buildTurns(session) {
  const turns = [], byId = new Map();
  const add = id => {
    const turn = {id, user:null, replies:[], activity:[], run:(session.runs ?? []).find(run=>run.id===id)};
    turns.push(turn); byId.set(id,turn); return turn;
  };
  const messagePositions = new Map(session.messages.map((message,index)=>[message,index+1]));
  let current;
  for (const message of session.messages) {
    if (message.role === 'user') {
      current = byId.get(message.runId) ?? add(message.runId ?? `user:${message.id}`);
      // The agent may echo role instructions and file context. Keep accepted input visible.
      current.user = typeof current.run?.text==='string' ? {...message,text:current.run.text,textTruncated:false} : message;
    } else {
      const knownRole=message.role==='thought'||message.role==='assistant';
      let turn=byId.get(message.runId);
      if(!turn){
        if(message.runId)turn=add(message.runId);
        else if(knownRole&&current)turn=current;
        else turn=byId.get('legacy-messages')??add('legacy-messages');
      }
      current = turn;
      if (message.role === 'thought') turn.activity.push({id:`thought:${message.id}`,type:'thought',text:message.text,item:message});
      else if (message.role === 'assistant') turn.replies.push(message);
      else turn.activity.push({id:`unknown:${message.id}`,type:'note',text:message.text,item:message,unknownRole:true});
    }
  }
  for (const tool of session.tools) {
    const turn = tool.runId ? byId.get(tool.runId) ?? add(tool.runId) : byId.get('legacy-tools') ?? add('legacy-tools');
    turn.activity.push({id:`tool:${tool.toolCallId}`,type:'tool',text:tool.title ?? tool.name ?? '工具调用',item:tool});
  }
  const activeRun = (session.runs ?? []).findLast(run=>isRunActive(run.status));
  if (isRunActive(session.status) && !turns.length) add(activeRun?.id ?? 'pending');
  for (const turn of turns) {
    turn.activity.sort((a,b)=>(a.item.activityOrder ?? 0)-(b.item.activityOrder ?? 0));
    turn.live = isRunActive(session.status) && (activeRun ? turn.id===activeRun.id : turn===turns.at(-1));
    // Preserve first-observed order, not the latest patch time. A completed search
    // update must not jump ahead of the assistant text that introduced it.
    const events = [
      ...turn.activity.map(activity=>({kind:'activity',activity,order:activity.item.activityOrder ?? messagePositions.get(activity.item) ?? 0})),
      ...turn.replies.map(message=>({kind:'message',message,order:message.activityOrder ?? messagePositions.get(message)})),
    ].sort((a,b)=>a.order-b.order);
    const lastReply=turn.replies.at(-1);
    const replyOrder=lastReply?.activityOrder ?? messagePositions.get(lastReply) ?? -1;
    const activityAfterReply=events.some(event=>event.kind==='activity' && event.order>replyOrder);
    turn.answer=lastReply && !activityAfterReply ? lastReply : null;
    turn.process=events.filter(event=>event.message!==turn.answer).map(event=>event.kind==='message'
      ? {id:`note:${event.message.id}`,type:'note',text:event.message.text,item:event.message}
      : event.activity);


  }
  return turns.sort((a,b)=>{
    const first=turn=>[turn.user,...turn.replies,...turn.activity.map(event=>event.item)].reduce((order,item)=>Math.min(order,item?.historyOrder??Infinity),Infinity);
    return first(a)-first(b);
  });
}

export function activityTail(text, limit=150) {
  const line=String(text ?? '').split(/\r?\n/).map(line=>line.trim()).filter(Boolean).at(-1) ?? '';
  return line.length>limit ? `…${line.slice(-limit)}` : line;
}

export function toolFamily(tool) {
  if(describeAction(tool).operation==='read')return 'read';
  const kind=describeTool(tool).kind;
  if (kind==='search' || kind==='web' || ['search','fetch'].includes(tool.kind)) return 'web';
  if (kind==='command' || tool.kind==='execute') return 'command';
  if (kind==='file' || ['read','edit','delete','move'].includes(tool.kind)) return 'file';
  return 'other';
}

export function groupProcess(events) {
  const groups=[];
  for (const event of events) {
    const last=groups.at(-1);
    if (event.type!=='tool') { groups.push({id:event.id,type:event.type,event}); continue; }
    const family=toolFamily(event.item);
    if (last?.type==='tools' && last.family===family) last.items.push(event);
    else groups.push({id:`tools:${event.id}`,type:'tools',family,items:[event]});
  }
  return groups;
}

export function formatDuration(seconds) {
  if (seconds<60) return `${seconds} 秒`;
  const minutes=Math.floor(seconds/60), remaining=seconds%60;
  return `${minutes} 分 ${remaining} 秒`;
}
