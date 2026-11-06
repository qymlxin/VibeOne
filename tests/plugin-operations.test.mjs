import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import http from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {host} from './helpers/host.mjs';

test('durable plugin receipts pin generations, deduplicate, survive lost replies and never replay after crash',{timeout:30000},async t=>{
 const {directory,connection,call}=await host(t);
 const path=join(directory,'operations-plugin');await mkdir(path);
 const counter=join(directory,'counter.txt');await writeFile(counter,'');
 const manifest={id:'dev.fixture.operations',name:'Operation fixture',version:'0.1.0',manifestVersion:1,engines:{pluginApi:'>=0.1 <0.2'},hostRequirements:[],entrypoints:{worker:{path:'worker.mjs',runtime:'node',protocolVersion:1}},contributions:[{id:'count',kind:'app.command',kindVersion:1,binding:{type:'worker',handler:'count'}}]};
 const worker=version=>`import {appendFile} from 'node:fs/promises';export default {apiVersion:'0.1',setup(r){r.handle('count',async(input)=>{await appendFile(${JSON.stringify(counter)},'x');await new Promise(resolve=>setTimeout(resolve,input.delay??30));if(input.fail)throw Error('fixture failed');return {version:${JSON.stringify(version)},value:input.value};});}};`;
 const install=async()=>{await writeFile(join(path,'plugin.json'),JSON.stringify(manifest));const candidate=await call('/plugins/prepare',{path,trusted:true,workspaces:[]});await call('/plugins/commit',{ticket:candidate.ticket});return candidate.plugin;};
 await writeFile(join(path,'worker.mjs'),worker('v1'));const plugin=await install();
 const submit=async(body,expected=202)=>{
   const response=await fetch(`${connection.url}/v1/plugins/${plugin.id}/operations`,{method:'POST',headers:{Authorization:`Bearer ${connection.token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
   const value=await response.json();assert.equal(response.status,expected,JSON.stringify(value));return value;
 };
 const status=id=>call(`/operations/${id}`);
 const ended=async(id)=>{for(let i=0;i<200;i++){const record=await status(id);if(!['accepted','running'].includes(record.state))return record;await sleep(15);}throw Error('operation did not settle');};
 const body={key:'same-key',handler:'count',input:{value:'one',delay:100}};
 const receipts=await Promise.all([submit(body),submit(body)]);
 assert.equal(receipts[0].operationId,receipts[1].operationId);
 assert.equal((await ended(receipts[0].operationId)).result.value,'one');
 assert.equal(await readFile(counter,'utf8'),'x');
 await submit({...body,input:{value:'different'}},409);
 await submit({key:'bad-generation',handler:'count',generation:plugin.generation+1,input:{}},400);
 await submit({key:'bad-handler',handler:'not-published',input:{}},400);
 const large=await submit({key:'within-plugin-limit',handler:'count',input:{value:'large',padding:'x'.repeat(300000)}});
 assert.equal((await ended(large.operationId)).result.value,'large');
 await submit({key:'outside-plugin-limit',handler:'count',input:{padding:'x'.repeat(550000)}},400);
 const failed=await ended((await submit({key:'failure',handler:'count',input:{fail:true}})).operationId);
 assert.equal(failed.state,'failed');assert.equal(failed.error.code,'PLUGIN_OPERATION_FAILED');
 const pending=await submit({key:'pinned',handler:'count',input:{delay:600,value:'old'}});
 await writeFile(join(path,'worker.mjs'),worker('v2'));manifest.version='0.2.0';await install();
 assert.equal((await ended(pending.operationId)).result.version,'v1');
 assert.equal((await ended((await submit({key:'new-generation',handler:'count',input:{}})).operationId)).result.version,'v2');
 const lost={key:'lost-receipt',handler:'count',input:{delay:200,value:'lost'}};
 await new Promise((resolve,reject)=>{
   const req=http.request(`${connection.url}/v1/plugins/${plugin.id}/operations`,{method:'POST',headers:{Authorization:`Bearer ${connection.token}`,'Content-Type':'application/json'}},response=>{assert.equal(response.statusCode,202);response.destroy();resolve();});
   req.on('error',reject);req.end(JSON.stringify(lost));
 });
 const recovered=(await call('/operations')).operations.find(record=>record.key===lost.key);
 assert.ok(recovered);assert.equal((await ended(recovered.id)).result.value,'lost');
 const summaries=(await call('/snapshot')).operations;
 assert.equal(summaries.some(record=>'result' in record||'fingerprint' in record),false);
 assert.equal((await fetch(`${connection.url}/v1/operations/${recovered.id}`)).status,401);
 const interrupted=await submit({key:'crash',handler:'count',input:{delay:10000,value:'must not replay'}});
 for(let i=0;i<100;i++){if((await status(interrupted.operationId)).state==='running')break;await sleep(10);}
 process.kill(connection.pid,'SIGKILL');
 for(let i=0;i<100;i++){try{process.kill(connection.pid,0);}catch{break;}await sleep(15);}
 const before=await readFile(counter,'utf8');
 const child=spawn(resolve('target/debug/vibeone-host'),['serve','--data-dir',directory],{stdio:'ignore'}),exited=once(child,'exit');
 let next;
 try {
   for(let i=0;i<150;i++){try{const record=JSON.parse(await readFile(join(directory,'host.json'),'utf8'));if(record.pid===child.pid){next=record;break;}}catch{}await sleep(20);}
   assert.ok(next,'restarted fixture Host must be ready');
   const query=async id=>(await fetch(`${next.url}/v1/operations/${id}`,{headers:{Authorization:`Bearer ${next.token}`}})).json();
   assert.equal((await query(interrupted.operationId)).state,'interrupted');
   assert.equal((await query(receipts[0].operationId)).result.value,'one');
   await sleep(250);assert.equal(await readFile(counter,'utf8'),before,'unfinished work must not replay');
 }finally{
   if(next)await fetch(`${next.url}/v1/host/stop`,{method:'POST',headers:{Authorization:`Bearer ${next.token}`}}).catch(()=>{});
   const force=setTimeout(()=>child.kill('SIGKILL'),8500);await exited;clearTimeout(force);
 }
});
