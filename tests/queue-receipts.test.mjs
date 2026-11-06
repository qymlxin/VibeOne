import test from 'node:test';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {once} from 'node:events';import {readFile} from 'node:fs/promises';import {join,resolve} from 'node:path';import {setTimeout as sleep} from 'node:timers/promises';
import {host} from './helpers/host.mjs';import {controlQueue} from '@vibeone/client-contracts';

test('queue receipts retain accepted intent across state changes and restart without replaying control',{timeout:26000},async t=>{
 const {call,wait,directory,connection,exited}=await host(t);const {id}=await call('/sessions',{provider:'demo',workspace:directory});const base=`/sessions/${id}`;
 await call(base+'/messages',{text:'/wait'});await wait(id,s=>s.status==='running');
 const first=await call(base+'/messages',{text:'withdraw me'}),second=await call(base+'/messages',{text:'keep me'});
 const pause=controlQueue(id,{pause:true,key:'pause-one'}),resume=controlQueue(id,{resume:true,key:'resume-one'}),withdraw=controlQueue(id,{withdraw:first.operationId,key:'withdraw-one'});
 await call(...pause);await call(...resume);await call(...pause);
 let session=(await call('/snapshot')).sessions.find(s=>s.id===id);assert.equal(session.queuePaused,false,'an old pause must not undo a later resume');
 await call(...controlQueue(id,{pause:true,key:'pause-two'}));await call(...resume);
 session=(await call('/snapshot')).sessions.find(s=>s.id===id);assert.equal(session.queuePaused,true,'an old resume must not undo a later pause');
 await call(...withdraw);const count=(await call('/event-log?after=0')).events.filter(event=>event.kind==='queue.updated').length;
 const duplicates=await Promise.all(Array.from({length:6},()=>call(...withdraw)));assert.ok(duplicates.every(result=>result.updated===true));assert.equal((await call('/event-log?after=0')).events.filter(event=>event.kind==='queue.updated').length,count);
 assert.equal((await call(...controlQueue(id,{withdraw:second.operationId,key:'withdraw-one'}),false)).code,'IDEMPOTENCY_CONFLICT');
 assert.equal((await call(...controlQueue(id,{withdraw:first.operationId}),false)).code,'QUEUE_CONFLICT','legacy stale withdrawal keeps its real conflict');
 for(const key of ['', 'x'.repeat(129)])assert.equal((await call(...controlQueue(id,{pause:true,key}),false)).code,'INVALID_INPUT');
 await call('/host/stop',{});await exited;
 const child=spawn(resolve('target/debug/vibeone-host'),['serve','--data-dir',directory],{stdio:'ignore'}),done=once(child,'exit');let next;
 try{
  for(let i=0;i<150;i++){try{const d=JSON.parse(await readFile(join(directory,'host.json'),'utf8'));if(d.pid===child.pid){next=d;break;}}catch{}await sleep(25);}
  assert.ok(next);Object.assign(connection,next);
  assert.deepEqual(await call(...withdraw),{updated:true});assert.deepEqual(await call(...resume),{updated:true});
  session=(await call('/snapshot')).sessions.find(s=>s.id===id);assert.equal(session.queuePaused,true);assert.equal(session.historyOnly,true);assert.deepEqual(session.queue.map(run=>run.id),[second.operationId]);
  assert.equal((await call(...controlQueue(id,{resume:true,key:'new-resume'}),false)).code,'CONTEXT_CONFLICT');
  await call(...controlQueue(id,{resume:true,freshContext:true,key:'fresh-resume'}));
  await wait(id,s=>s.runs.some(run=>run.id===second.operationId&&run.status==='completed'));
  assert.equal(JSON.stringify(await call('/snapshot')).includes('withdraw-one'),false);
 }finally{if(next)await fetch(next.url+'/v1/host/stop',{method:'POST',headers:{Authorization:`Bearer ${next.token}`}}).catch(()=>{});const kill=setTimeout(()=>child.kill('SIGKILL'),8500);try{await done;}finally{clearTimeout(kill);}}
});
