import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {snapshotRecords,mergeHistory,historyBounds} from './conversation-history.js';

export function useConversationHistory({session,workbench,online,onBeforeMerge}) {
  const enabled=workbench.features?.includes('conversationHistory');
  const initial=snapshotRecords(session);
  const cache=useRef(initial),latest=useRef(initial),beforeMerge=useRef(onBeforeMerge);
  latest.current=initial;beforeMerge.current=onBeforeMerge;
  const [records,setRecords]=useState(initial),[status,setStatus]=useState({ready:false,busy:false,error:'',hasMore:false,warnings:[]});
  const finishedRun=session.runs?.findLast(run=>run.finishedAt)?.id??null;
  const pendingSync=useRef(false),previousFinished=useRef(finishedRun);
  const statusRef=useRef(status),flight=useRef(null),generation=useRef(0),[retry,setRetry]=useState(0);
  statusRef.current=status;
  const publish=useCallback(incoming=>{
    const merged=mergeHistory(mergeHistory(cache.current,incoming),latest.current);
    if(merged!==cache.current){beforeMerge.current?.();cache.current=merged;setRecords(merged);}
  },[]);
  useEffect(()=>publish(initial),[session.messages,session.tools,publish]);
  const fetchPages=useCallback(async(older=false)=>{
    if(!enabled||!online||flight.current)return;
    pendingSync.current=false;
    const controller=new AbortController(),epoch=generation.current;
    flight.current=controller;
    const start=historyBounds(mergeHistory(cache.current,latest.current));
    const target=start.first;
    let before=older?statusRef.current.nextBefore:undefined;
    if(older&&!before){flight.current=null;return;}
    setStatus(previous=>({...previous,busy:true,error:''}));
    let succeeded=false;
    try{
      let page;const collected=[];
      do{
        const limit=!older&&target&&before?Math.max(1,Math.min(128,before-target)):128;
        page=await workbench.read(`/sessions/${session.id}/history?limit=${limit}${before?`&before=${before}`:''}`,controller.signal);
        if(controller.signal.aborted||epoch!==generation.current)return;
        collected.push(...page.records);
        if(!page.hasMore||older||!target||page.nextBefore<=target)break;
        if(!page.nextBefore||(before&&page.nextBefore>=before))throw Error('历史分页游标没有前进，请重试');
        before=page.nextBefore;
      }while(true);
      succeeded=true;publish(collected);
      setStatus({ready:true,busy:false,error:'',hasMore:page.hasMore,nextBefore:page.nextBefore,warnings:page.warnings??[]});
    }catch(error){
      if(!controller.signal.aborted&&epoch===generation.current)setStatus(previous=>({...previous,busy:false,error:String(error.message??error)}));
    }finally{
      if(flight.current===controller){flight.current=null;if(succeeded&&(pendingSync.current||older||!historyBounds(mergeHistory(cache.current,latest.current)).continuous))setRetry(value=>value+1);}
    }
  },[enabled,online,session.id,workbench.read,publish]);
  // A new connection resynchronizes all loaded orders; cleanup invalidates late responses.
  useEffect(()=>{
    generation.current++;flight.current?.abort();flight.current=null;
    setStatus(previous=>({...previous,busy:false}));
    void fetchPages();
    return()=>{generation.current++;flight.current?.abort();flight.current=null;};
  },[fetchPages]);
  useEffect(()=>{
    const bounds=historyBounds(mergeHistory(cache.current,latest.current));
    if(enabled&&online&&(!statusRef.current.ready||pendingSync.current||!bounds.continuous))void fetchPages();
  },[session.historySequence,retry,enabled,online,fetchPages]);
  useEffect(()=>{
    if(previousFinished.current!==finishedRun){pendingSync.current=true;void fetchPages();}
    previousFinished.current=finishedRun;
  },[finishedRun,fetchPages]);
  const merged=useMemo(()=>mergeHistory(records,snapshotRecords(session)),[records,session.messages,session.tools]);
  const view=useMemo(()=>({...session,messages:merged.filter(record=>record.kind==='message').map(record=>record.item),tools:merged.filter(record=>record.kind==='tool').map(record=>record.item)}),[session,merged]);
  return {session:view,...status,enabled,loadOlder:()=>fetchPages(true),retry:()=>fetchPages()};
}
