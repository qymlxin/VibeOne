export const isRunActive = status => ['starting', 'running', 'requires_action', 'cancelling'].includes(status);

// Group by durable Run identity. Older records without identity retain message order;
// unassigned legacy tools stay separate rather than being attributed to a new turn.
export function buildTurns(session) {
  const turns = [], byId = new Map();
  const add = id => {
    const turn = {id, user:null, replies:[], activity:[], run:(session.runs ?? []).find(run=>run.id===id)};
    turns.push(turn); byId.set(id,turn); return turn;
  };
  let current;
  for (const message of session.messages) {
    if (message.role === 'user') {
      current = byId.get(message.runId) ?? add(message.runId ?? `user:${message.id}`);
      current.user = message;
    } else {
      const turn = byId.get(message.runId) ?? (message.runId ? add(message.runId) : current ?? add('legacy-messages'));
      current = turn;
      if (message.role === 'thought') turn.activity.push({id:`thought:${message.id}`,type:'thought',text:message.text,item:message});
      else if (message.role === 'assistant') turn.replies.push(message);
    }
  }
  for (const tool of session.tools) {
    const turn = byId.get(tool.runId) ?? byId.get('legacy-tools') ?? add('legacy-tools');
    turn.activity.push({id:`tool:${tool.toolCallId}`,type:'tool',text:tool.title ?? tool.name ?? '工具调用',item:tool});
  }
  const activeRun = (session.runs ?? []).findLast(run=>isRunActive(run.status));
  if (isRunActive(session.status) && !turns.length) add(activeRun?.id ?? 'pending');
  for (const turn of turns) {
    for (const message of turn.replies.slice(0,-1)) turn.activity.push({id:`note:${message.id}`,type:'note',text:message.text,item:message});
    turn.reply = turn.replies.at(-1);
    turn.activity.sort((a,b)=>(a.item.activityOrder ?? 0)-(b.item.activityOrder ?? 0));
    turn.live = isRunActive(session.status) && (activeRun ? turn.id===activeRun.id : turn===turns.at(-1));
  }
  return turns;
}

export function activityTail(text, limit=150) {
  const line=String(text ?? '').split(/\r?\n/).map(line=>line.trim()).filter(Boolean).at(-1) ?? '';
  return line.length>limit ? `…${line.slice(-limit)}` : line;
}
