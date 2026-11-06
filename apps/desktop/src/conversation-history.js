// The archive order survives upstream ID changes (pending input -> accepted input).
const ordered = item => Number.isSafeInteger(item?.historyOrder) && item.historyOrder > 0;
const identity = ({kind,item}) => ordered(item) ? `order:${item.historyOrder}` : `${kind}:${item.role ?? ''}:${item.runId ?? ''}:${item.id ?? item.toolCallId}`;
export function snapshotRecords(session) {
  return [...(session.messages ?? []).map(item=>({kind:'message',item})),...(session.tools ?? []).map(item=>({kind:'tool',item}))];
}
export function mergeHistory(previous, incoming) {
  const records=new Map(previous.map(record=>[identity(record),record]));
  let changed=false;
  for(const record of incoming){
    if(!['message','tool'].includes(record?.kind)||!record.item||typeof record.item!=='object')continue;
    const key=identity(record),old=records.get(key);
    if(old && (old.item.historyRevision ?? 0)>(record.item.historyRevision ?? 0))continue;
    if(old?.item===record.item)continue;
    records.set(key,record);changed=true;
  }
  return changed?[...records.values()].sort((a,b)=>(a.item.historyOrder ?? a.item.activityOrder ?? 0)-(b.item.historyOrder ?? b.item.activityOrder ?? 0)):previous;
}
export function historyBounds(records) {
  const orders=records.filter(record=>ordered(record.item)).map(record=>record.item.historyOrder).sort((a,b)=>a-b);
  return {first:orders[0],last:orders.at(-1),continuous:orders.every((order,index)=>!index||order===orders[index-1]+1)};
}
// Anchor to the visible record, not total scroll height: the end can stream concurrently.
export function captureHistoryAnchor(root) {
  if(!root)return null;
  const top=root.getBoundingClientRect().top;
  const node=[...root.querySelectorAll('[data-history-order]')].find(node=>node.getClientRects().length && node.getBoundingClientRect().bottom>top);
  if(node)return {order:node.dataset.historyOrder,offset:node.getBoundingClientRect().top-top};
  const turn=[...root.querySelectorAll('[data-turn-id]')].find(node=>node.getBoundingClientRect().bottom>top);
  return turn?{turn:turn.dataset.turnId,offset:turn.getBoundingClientRect().top-top}:null;
}
export function restoreHistoryAnchor(root,anchor) {
  if(!root||!anchor)return;
  const node=[...root.querySelectorAll(anchor.order?'[data-history-order]':'[data-turn-id]')].find(node=>anchor.order?node.dataset.historyOrder===anchor.order:node.dataset.turnId===anchor.turn);
  if(node)root.scrollTop+=node.getBoundingClientRect().top-root.getBoundingClientRect().top-anchor.offset;
}
