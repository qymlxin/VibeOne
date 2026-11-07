import test from 'node:test';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {once} from 'node:events';import {readFile,writeFile,rm} from 'node:fs/promises';import {join,resolve} from 'node:path';import {setTimeout as sleep} from 'node:timers/promises';
import {host} from './helpers/host.mjs';import {captureArtifact} from '@vibeone/client-contracts';
test('artifact receipts retain the first content and identity across edits, deletion, new Runs and restart',{timeout:26000},async t=>{
 const {call,wait,directory,connection,exited}=await host(t);await writeFile(join(directory,'snapshot.txt'),'original snapshot');
 const {id}=await call('/sessions',{provider:'demo',workspace:directory});const command=captureArtifact(id,'snapshot.txt','capture-one');
 const values=await Promise.all(Array.from({length:6},()=>call(...command)));const original=values[0];assert.ok(values.every(value=>value.id===original.id));assert.equal(original.content.text,'original snapshot');assert.equal(original.runId,null);
 assert.equal((await call(`/sessions/${id}/artifacts`)).length,1);
 await writeFile(join(directory,'snapshot.txt'),'new content');assert.deepEqual(await call(...command),original);
 const newer=await call(...captureArtifact(id,'snapshot.txt','capture-two'));assert.notEqual(newer.id,original.id);assert.equal(newer.content.text,'new content');
 assert.equal((await call(...captureArtifact(id,'different.txt','capture-one'),false)).code,'IDEMPOTENCY_CONFLICT');
 await rm(join(directory,'snapshot.txt'));await call(`/sessions/${id}/messages`,{text:'after capture'});await wait(id,s=>s.stopReason==='end_turn');assert.deepEqual(await call(...command),original);
 const events=(await call('/event-log?after=0')).events.filter(event=>event.kind==='artifact.updated');assert.equal(events.length,2);
 await writeFile(join(directory,'legacy.txt'),'legacy');const legacyA=await call(...captureArtifact(id,'legacy.txt')),legacyB=await call(...captureArtifact(id,'legacy.txt'));assert.notEqual(legacyA.id,legacyB.id);
 for(const key of ['', 'x'.repeat(129)])assert.equal((await call(...captureArtifact(id,'legacy.txt',key),false)).code,'INVALID_INPUT');
 assert.equal(JSON.stringify(await call('/snapshot')).includes('capture-one'),false);
 await call('/host/stop',{});await exited;
 const child=spawn(resolve('target/debug/vibeone-host'),['serve','--data-dir',directory],{stdio:'ignore'}),done=once(child,'exit');let next;
 try{
  for(let i=0;i<150;i++){try{const d=JSON.parse(await readFile(join(directory,'host.json'),'utf8'));if(d.pid===child.pid){next=d;break;}}catch{}await sleep(25);}
  assert.ok(next);Object.assign(connection,next);assert.deepEqual(await call(...command),original);assert.equal((await call(`/sessions/${id}/artifacts`)).length,4);
 }finally{if(next)await fetch(next.url+'/v1/host/stop',{method:'POST',headers:{Authorization:`Bearer ${next.token}`}}).catch(()=>{});const kill=setTimeout(()=>child.kill('SIGKILL'),8500);try{await done;}finally{clearTimeout(kill);}}
});
