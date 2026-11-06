import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFile,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {host} from './helpers/host.mjs';
import {createSession} from '@vibeone/client-contracts';

test('session creation retries share one durable identity and one default project across Host restart',{timeout:22000},async t=>{
 const {directory,connection,call,exited}=await host(t);
 const command=createSession('demo','',undefined,'one-intent');
 const receipts=await Promise.all(Array.from({length:8},()=>call(...command)));
 const id=receipts[0].id;assert.ok(id);assert.ok(receipts.every(item=>item.id===id));
 assert.equal((await readdir(join(directory,'projects'))).length,1);
 const snapshot=await call('/snapshot');assert.equal(snapshot.sessions.length,1);assert.ok(snapshot.features.includes('sessionCreationIdempotency'));
 assert.equal(JSON.stringify(snapshot).includes('one-intent'),false);
 for(const body of [{...command[1],provider:'changed'},{...command[1],workspace:directory},{...command[1],profileId:'changed'}]){
  const response=await fetch(connection.url+'/v1/sessions',{method:'POST',headers:{Authorization:`Bearer ${connection.token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal(response.status,409);assert.equal((await response.json()).code,'IDEMPOTENCY_CONFLICT');
 }
 for(const key of ['', 'x'.repeat(129)])assert.equal((await call('/sessions',{provider:'demo',key},false)).code,'INVALID_INPUT');
 const legacyA=await call('/sessions',{provider:'demo',workspace:directory}),legacyB=await call('/sessions',{provider:'demo',workspace:directory});assert.notEqual(legacyA.id,legacyB.id);
 await call('/host/stop',{});await exited;
 const restarted=spawn(resolve('target/debug/vibeone-host'),['serve','--data-dir',directory],{stdio:'ignore'}),done=once(restarted,'exit');let next;
 try{
  for(let attempt=0;attempt<150;attempt++){
   try{const descriptor=JSON.parse(await readFile(join(directory,'host.json'),'utf8'));if(descriptor.pid===restarted.pid){next=descriptor;break;}}catch{}
   await sleep(25);
  }
  assert.ok(next);
  const response=await fetch(next.url+'/v1/sessions',{method:'POST',headers:{Authorization:`Bearer ${next.token}`,'Content-Type':'application/json'},body:JSON.stringify(command[1])});
  assert.equal(response.status,200);assert.equal((await response.json()).id,id);
  assert.equal((await readdir(join(directory,'projects'))).length,1);
 }finally{
  if(next)await fetch(next.url+'/v1/host/stop',{method:'POST',headers:{Authorization:`Bearer ${next.token}`}}).catch(()=>{});
  const kill=setTimeout(()=>restarted.kill('SIGKILL'),8500);try{await done;}finally{clearTimeout(kill);}
 }
});
