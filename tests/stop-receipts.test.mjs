import test from 'node:test';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {once} from 'node:events';
import {readFile} from 'node:fs/promises';import {join,resolve} from 'node:path';import {setTimeout as sleep} from 'node:timers/promises';
import {host} from './helpers/host.mjs';import {cancelSession} from '@vibeone/client-contracts';

test('durable stop receipts and Run preconditions prevent old requests from cancelling later work',{timeout:24000},async t=>{
 const {call,wait,directory,connection,exited}=await host(t);const {id}=await call('/sessions',{provider:'demo',workspace:directory});
 const old=cancelSession(id,'idle-stop');assert.deepEqual(await call(...old),{cancelRequested:true});
 const duplicates=await Promise.all(Array.from({length:6},()=>call(...old)));assert.ok(duplicates.every(result=>result.cancelRequested===true));
 assert.equal((await call('/event-log?after=0')).events.filter(e=>e.kind==='run.stop_noop').length,1);
 assert.equal((await call(...cancelSession(id,'idle-stop','different-run'),false)).code,'IDEMPOTENCY_CONFLICT');
 for(const key of ['', 'x'.repeat(129)])assert.equal((await call(...cancelSession(id,key),false)).code,'INVALID_INPUT');
 await call('/host/stop',{});await exited;
 const child=spawn(resolve('target/debug/vibeone-host'),['serve','--data-dir',directory],{stdio:'ignore'}),done=once(child,'exit');let next;
 try{
  for(let i=0;i<150;i++){try{const candidate=JSON.parse(await readFile(join(directory,'host.json'),'utf8'));if(candidate.pid===child.pid){next=candidate;break;}}catch{}await sleep(25);}
  assert.ok(next);Object.assign(connection,next);
  const run=await call(`/sessions/${id}/messages`,{text:'/wait'});await wait(id,s=>s.status==='running');
  assert.deepEqual(await call(...old),{cancelRequested:true});
  let current=(await call('/snapshot')).sessions.find(s=>s.id===id);assert.equal(current.runs.find(item=>item.id===run.operationId).status,'running');assert.equal(current.status,'running');assert.equal(current.queuePaused,false);
  assert.equal((await call(...cancelSession(id,'wrong-target','older-run'),false)).code,'CONTEXT_CONFLICT');
  current=(await call('/snapshot')).sessions.find(s=>s.id===id);assert.equal(current.status,'running');
  const stop=cancelSession(id,'bound-stop',run.operationId);assert.deepEqual(await call(...stop),{cancelRequested:true});
  await wait(id,s=>s.stopReason==='cancelled');assert.deepEqual(await call(...stop),{cancelRequested:true});
  assert.equal((await call(...cancelSession(id,'new-stale-intent',run.operationId),false)).code,'CONTEXT_CONFLICT');
  const response=await fetch(connection.url+`/v1/sessions/${id}/cancel`,{method:'POST',headers:{Authorization:`Bearer ${connection.token}`}});assert.equal(response.status,200);
  assert.equal(JSON.stringify(await call('/snapshot')).includes('bound-stop'),false);
 }finally{if(next)await fetch(next.url+'/v1/host/stop',{method:'POST',headers:{Authorization:`Bearer ${next.token}`}}).catch(()=>{});const kill=setTimeout(()=>child.kill('SIGKILL'),8500);try{await done;}finally{clearTimeout(kill);}}
});
