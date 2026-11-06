// Cursor state belongs to one connection. The Host, never this reducer, interprets ACP.
export class SyncProtocolError extends Error {}
const integer=value=>Number.isSafeInteger(value)&&value>=0;
export function applySync(current,frame) {
  if(frame?.version!==1||typeof frame.epoch!=='string'||!integer(frame.cursor))throw new SyncProtocolError('unsupported-envelope');
  if(frame.reset){
    if(!Array.isArray(frame.snapshot?.sessions)||frame.snapshot.revision!==frame.cursor)throw new SyncProtocolError('invalid-snapshot');
    if(current?.epoch===frame.epoch&&current.cursor>frame.cursor)return current;
    return {epoch:frame.epoch,cursor:frame.cursor,snapshot:frame.snapshot};
  }
  if(!current||current.epoch!==frame.epoch)throw new SyncProtocolError('epoch-mismatch');
  if(frame.cursor<current.cursor||frame.from<current.cursor&&frame.cursor===current.cursor)return current;
  if(frame.from!==current.cursor||frame.cursor<frame.from||frame.metadata?.revision!==frame.cursor||!Array.isArray(frame.events)||!Array.isArray(frame.visibleSessionIds))throw new SyncProtocolError('cursor-gap');
  const visible=new Set(frame.visibleSessionIds);
  const sessions=new Map(current.snapshot.sessions.filter(session=>visible.has(session.id)).map(session=>[session.id,session]));
  const seen=new Set(),versions=new Map();
  for(const event of frame.events){
    if(event.type!=='session.projected')throw new SyncProtocolError('unknown-event');
    if(typeof event.id!=='string'||!integer(event.cursor)||event.cursor<=frame.from||event.cursor>frame.cursor||typeof event.session?.id!=='string'||!visible.has(event.session.id))throw new SyncProtocolError('invalid-event');
    if(seen.has(event.id))continue;
    seen.add(event.id);
    if(event.cursor>(versions.get(event.session.id)??-1)){versions.set(event.session.id,event.cursor);sessions.set(event.session.id,event.session);}
  }
  if([...visible].some(id=>!sessions.has(id)))throw new SyncProtocolError('missing-session');
  return {epoch:frame.epoch,cursor:frame.cursor,snapshot:{...frame.metadata,sessions:[...sessions.values()].sort((a,b)=>a.id.localeCompare(b.id))}};
}

export function createWorkbenchSync(read,publish) {
  let projection=null,legacy=false,closed=false,running=false;
  const waiters=[];
  const diagnostics={recoveries:0,lastReason:null};
  const accept=next=>{if(!closed){projection=next;publish({...next.snapshot,syncDiagnostics:{...diagnostics}});}};
  const snapshot=async()=>{
    const next=await read('/snapshot');
    if(!projection||next.revision>=projection.cursor)accept({epoch:null,cursor:next.revision,snapshot:next});
  };
  const update=async()=>{
      if(legacy){await snapshot();return;}
      try {
        const path=projection?`/sync?epoch=${encodeURIComponent(projection.epoch)}&after=${projection.cursor}`:'/sync';
        const frame=await read(path);
        if(!closed)accept(applySync(projection,frame));
      }catch(error){
        if(closed)return;
        if(error.status===404||error instanceof SyncProtocolError){
          diagnostics.recoveries++;diagnostics.lastReason=error.status===404?'legacy-host':error.message;
          if(error.status===404||error.message==='unsupported-envelope'){
            legacy=true;await snapshot();
          }else{
            // An unknown event or sequence gap cannot safely advance the cursor.
            const frame=await read('/sync');
            if(!frame.reset)throw new SyncProtocolError('missing-reset');
            accept(applySync(null,frame));
          }
        }else throw error;
      }
  };
  const pump=async()=>{
    running=true;
    try {
      while(waiters.length&&!closed){
        const batch=waiters.splice(0);
        try {await update();for(const waiter of batch)waiter.resolve();}
        catch(error){for(const waiter of [...batch,...waiters.splice(0)])waiter.reject(error);}
      }
    }finally{running=false;}
  };
  return {
    refresh(){
      if(closed)return Promise.resolve();
      const result=new Promise((resolve,reject)=>waiters.push({resolve,reject}));
      if(!running)void pump();
      return result;
    },
    close(){closed=true;for(const waiter of waiters.splice(0))waiter.resolve();},
  };
}
