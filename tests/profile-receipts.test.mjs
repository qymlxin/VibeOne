import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {host} from './helpers/host.mjs';
import {saveProfile,removeProfile} from '@vibeone/client-contracts';

test('Profile command receipts deduplicate creation, revision and removal and survive restart',{timeout:22000},async t=>{
 const {call,directory,connection,exited}=await host(t);
 const create=saveProfile({name:'Durable Profile',provider:'demo',key:'create-intent'});
 const created=await Promise.all(Array.from({length:6},()=>call(...create)));
 const original=created[0];assert.ok(created.every(result=>JSON.stringify(result)===JSON.stringify(original)));assert.equal(original.revision,1);
 assert.equal((await call('/profiles')).profiles.length,1);
 const update=saveProfile({...original,name:'Updated Profile',key:'update-intent'});
 const updated=await call(...update);assert.equal(updated.revision,2);assert.deepEqual(await call(...update),updated);
 assert.equal((await call('/profiles')).profiles[0].revision,2);
 assert.equal((await call(...saveProfile({...original,name:'stale',key:'stale-intent'}),false)).code,'PROFILE_CONFLICT');
 assert.equal((await call(...saveProfile({...create[1],name:'different'}),false)).code,'IDEMPOTENCY_CONFLICT');
 assert.equal((await call(...removeProfile(original.id,2,undefined,'update-intent'),false)).code,'IDEMPOTENCY_CONFLICT');
 const removal=removeProfile(original.id,2,undefined,'remove-intent');assert.deepEqual(await call(...removal),{removed:true});assert.deepEqual(await call(...removal),{removed:true});
 assert.deepEqual(await call(...create),original,'historical success must not create another Profile after removal');assert.equal((await call('/profiles')).profiles.length,0);
 assert.equal((await call('/event-log?after=0')).events.filter(event=>event.kind==='profile.updated').length,3,'duplicates and conflicts must not append extra configuration events');
 const legacyA=await call('/profiles',{name:'Legacy',provider:'demo'}),legacyB=await call('/profiles',{name:'Legacy',provider:'demo'});assert.notEqual(legacyA.id,legacyB.id);
 for(const key of ['', 'x'.repeat(129)])assert.equal((await call('/profiles',{name:'invalid',provider:'demo',key},false)).code,'INVALID_INPUT');
 assert.equal(JSON.stringify(await call('/snapshot')).includes('create-intent'),false);
 await call('/host/stop',{});await exited;
 const child=spawn(resolve('target/debug/vibeone-host'),['serve','--data-dir',directory],{stdio:'ignore'}),done=once(child,'exit');let next;
 try{
  for(let attempt=0;attempt<150;attempt++){try{const descriptor=JSON.parse(await readFile(join(directory,'host.json'),'utf8'));if(descriptor.pid===child.pid){next=descriptor;break;}}catch{}await sleep(25);}
  assert.ok(next);
  for(const [command,expected]of [[create,original],[update,updated],[removal,{removed:true}]]){
   const response=await fetch(next.url+'/v1'+command[0],{method:'POST',headers:{Authorization:`Bearer ${next.token}`,'Content-Type':'application/json'},body:JSON.stringify(command[1])});assert.equal(response.status,200);assert.deepEqual(await response.json(),expected);
  }
 }finally{if(next)await fetch(next.url+'/v1/host/stop',{method:'POST',headers:{Authorization:`Bearer ${next.token}`}}).catch(()=>{});const kill=setTimeout(()=>child.kill('SIGKILL'),8500);try{await done;}finally{clearTimeout(kill);}}
});
