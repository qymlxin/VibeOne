import test from 'node:test';
import assert from 'node:assert/strict';
import {applySync,createWorkbenchSync,SyncProtocolError} from '../apps/desktop/src/workbench-sync.ts';
const reset=(cursor=1,epoch='host-a')=>({version:1,epoch,cursor,reset:'initial',snapshot:{revision:cursor,sessions:[{id:'a',text:'one'},{id:'b',text:'two'}]}});
const delta=(from=1,cursor=2)=>({version:1,epoch:'host-a',from,cursor,metadata:{revision:cursor,providers:[]},visibleSessionIds:['a','b'],events:[{id:'event-2',cursor:2,type:'session.projected',session:{id:'a',text:'updated'}}]});

test('projection sync merges changed sessions, deduplicates and retains unaffected identity',()=>{
 const first=applySync(null,reset()),frame=delta();frame.events.push({...frame.events[0],session:{id:'a',text:'duplicate must not overwrite'}});
 const next=applySync(first,frame);
 assert.equal(next.snapshot.sessions[0].text,'updated');
 assert.equal(next.snapshot.sessions[1],first.snapshot.sessions[1]);
 assert.equal(applySync(next,frame),next);
 assert.equal(applySync(next,reset()),next);
 const filtered=delta(2,2);filtered.events=[];filtered.visibleSessionIds=['a'];
 assert.deepEqual(applySync(next,filtered).snapshot.sessions.map(item=>item.id),['a']);
 const restarted=applySync(next,reset(0,'host-b'));
 assert.equal(restarted.cursor,0);assert.equal(restarted.epoch,'host-b');
});

test('gaps and unknown events cannot advance a trusted projection',()=>{
 const first=applySync(null,reset());
 for(const frame of [{...delta(),from:0},{...delta(),epoch:'other'},{...delta(),events:[{type:'future.operation'}]},{...delta(),events:[],visibleSessionIds:['a','b','missing']}])assert.throws(()=>applySync(first,frame),SyncProtocolError);
 assert.equal(first.cursor,1);
});

test('refresh serializes reads and a request made during delivery waits for a fresh query',async()=>{
 let release,reads=0,inflight=0,max=0;
 const snapshots=[];
 const sync=createWorkbenchSync(async path=>{
  reads++;max=Math.max(max,++inflight);
  if(reads===1){assert.equal(path,'/sync');await new Promise(resolve=>{release=resolve;});inflight--;return reset();}
  assert.equal(path,'/sync?epoch=host-a&after=1');inflight--;return delta();
 },snapshot=>snapshots.push(snapshot));
 const first=sync.refresh(),second=sync.refresh(),third=sync.refresh();
 release();await Promise.all([first,second,third]);
 assert.equal(reads,2);assert.equal(max,1);assert.equal(snapshots.at(-1).revision,2);
 sync.close();await sync.refresh();assert.equal(reads,2);
});

test('unknown future events trigger a new snapshot with bounded compatibility diagnostics',async()=>{
 const paths=[],snapshots=[];
 const frames=[reset(),{...delta(),events:[{type:'new-kind',private:'do not retain'}]},reset(3)];
 const sync=createWorkbenchSync(async path=>{paths.push(path);return frames.shift();},snapshot=>snapshots.push(snapshot));
 await sync.refresh();await sync.refresh();
 assert.deepEqual(paths,['/sync','/sync?epoch=host-a&after=1','/sync']);
 assert.deepEqual(snapshots.at(-1).syncDiagnostics,{recoveries:1,lastReason:'unknown-event'});
 assert.equal(JSON.stringify(snapshots).includes('do not retain'),false);
});

test('legacy 404 falls back while authentication failures never do',async()=>{
 const paths=[];
 const sync=createWorkbenchSync(async path=>{paths.push(path);if(path==='/sync')throw Object.assign(Error('old Host'),{status:404});return reset().snapshot;},()=>{});
 await sync.refresh();await sync.refresh();assert.deepEqual(paths,['/sync','/snapshot','/snapshot']);
 let reads=0;
 const denied=createWorkbenchSync(async()=>{reads++;throw Object.assign(Error('revoked'),{status:401});},()=>assert.fail('must not publish'));
 await assert.rejects(denied.refresh(),/revoked/);assert.equal(reads,1);
});

test('closing a connection prevents its pending response from replacing the next Host',async()=>{
 let release,published=false;
 const sync=createWorkbenchSync(()=>new Promise(resolve=>{release=resolve;}),()=>{published=true;});
 const pending=sync.refresh();sync.close();release(reset());await pending;assert.equal(published,false);
});
