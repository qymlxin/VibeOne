import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {host} from './helpers/host.mjs';

test('platform Host authenticates, executes ACP, approves and restores history',{timeout:30000},async t=>{
 const {call,wait,connection,directory,exited}=await host(t);
 assert.equal((await fetch(connection.url+'/v1/snapshot')).status,401);
 assert.equal((await fetch(connection.url+'/v1/snapshot',{headers:{Authorization:`Bearer ${connection.token}`,Origin:'https://not-trusted.invalid'}})).status,403);
 const {id}=await call('/sessions',{provider:'demo',workspace:directory,key:'ci-session'});
 assert.equal((await call('/sessions',{provider:'demo',workspace:directory,key:'ci-session'})).id,id);
 const base=`/sessions/${id}`;
 const message={text:'CI persisted message',key:'ci-message'};
 const accepted=await call(base+'/messages',message);
 assert.equal((await call(base+'/messages',message)).operationId,accepted.operationId);
 await wait(id,s=>s.runs.some(run=>run.id===accepted.operationId&&run.status==='completed'));
 await call(base+'/messages',{text:'/approve',key:'ci-approval'});
 const pending=(await wait(id,s=>s.approvals.length===1)).approvals[0];
 assert.deepEqual(await call(`${base}/approvals/${pending.id}`,{option:pending.options[0].optionId}),{submitted:true});
 const before=await wait(id,s=>s.runs.length===2&&s.runs.every(run=>run.status==='completed'));
 assert.ok(before.messages.some(message=>message.role==='assistant'));
 await call('/host/stop',{});await exited;
 const child=spawn(resolve(`target/debug/vibeone-host${process.platform==='win32'?'.exe':''}`),['serve','--data-dir',directory],{stdio:'ignore'}),done=once(child,'exit');let descriptor;
 try {
  for(let attempt=0;attempt<200;attempt++){
   try{const d=JSON.parse(await readFile(join(directory,'host.json'),'utf8'));if(d.pid===child.pid){descriptor=d;break;}}catch{}
   await sleep(30);
  }
  assert.ok(descriptor,'restarted Host must publish its descriptor');Object.assign(connection,descriptor);
  const after=(await call('/snapshot')).sessions.find(session=>session.id===id);
  assert.equal(after.historyOnly,true);assert.deepEqual(after.messages,before.messages);assert.deepEqual(after.runs,before.runs);assert.equal(after.approvals.length,0);
 }finally{
  if(descriptor)await fetch(descriptor.url+'/v1/host/stop',{method:'POST',headers:{Authorization:`Bearer ${descriptor.token}`},signal:AbortSignal.timeout(2500)}).catch(()=>{});
  const kill=setTimeout(()=>child.kill('SIGKILL'),8500);try{await done;}finally{clearTimeout(kill);}
 }
});
