import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {host} from './helpers/host.mjs';

async function fixture(t){
 const harness=await host(t),source=join(harness.directory,'plugin'),counter=join(harness.directory,'starts');await mkdir(source);await writeFile(counter,'');
 const manifest={manifestVersion:1,id:'fixture.lifecycle',name:'Lifecycle fixture',version:'0.1.0',engines:{pluginApi:'>=0.1 <0.2'},entrypoints:{worker:{path:'worker.mjs',runtime:'node',protocolVersion:1}},contributions:[{id:'run',kind:'app.command',kindVersion:1,binding:{type:'worker',handler:'run'}}]};
 await writeFile(join(source,'plugin.json'),JSON.stringify(manifest));
 const worker=`import {appendFile} from 'node:fs/promises';export default {apiVersion:'0.1',async setup(r){await appendFile(${JSON.stringify(counter)},'x');r.handle('run',async()=>({alive:true}));}};`;
 await writeFile(join(source,'worker.mjs'),worker);
 const headers={Authorization:`Bearer ${harness.connection.token}`,'Content-Type':'application/json'};
 const submit=async(action,input,key=crypto.randomUUID(),status=202)=>{
  const response=await fetch(harness.connection.url+'/v1/plugin-lifecycle/operations',{method:'POST',headers,body:JSON.stringify({action,input,key}),signal:AbortSignal.timeout(4000)});const value=await response.json();assert.equal(response.status,status,JSON.stringify(value));return value;
 };
 const ended=async id=>{for(let i=0;i<300;i++){const record=await harness.call('/operations/'+id);if(!['accepted','running'].includes(record.state))return record;await sleep(20);}throw Error('lifecycle operation did not settle');};
 return {...harness,source,counter,worker,headers,submit,ended};
}

test('lifecycle receipts deduplicate two-stage publication and preserve the old plugin on failure',{timeout:25000},async t=>{
 const {call,source,counter,worker,submit,ended}=await fixture(t);
 assert.ok((await call('/snapshot')).features.includes('pluginLifecycleOperations'));
 const inspected=await ended((await submit('inspect',{path:source})).operationId);assert.equal(inspected.state,'succeeded');assert.equal(inspected.result.id,'fixture.lifecycle');
 await submit('prepare',{path:source,trusted:false},'untrusted',403);
 const requests=await Promise.all([submit('prepare',{path:source,trusted:true},'prepare-once'),submit('prepare',{path:source,trusted:true},'prepare-once')]);assert.equal(requests[0].operationId,requests[1].operationId);
 const prepared=await ended(requests[0].operationId);assert.equal(prepared.state,'succeeded');assert.equal(await readFile(counter,'utf8'),'x');
 await submit('prepare',{path:source,trusted:true,config:{different:true}},'prepare-once',409);
 const commits=await Promise.all([submit('commit',{ticket:prepared.result.ticket},'commit-once'),submit('commit',{ticket:prepared.result.ticket},'commit-once')]);assert.equal(commits[0].operationId,commits[1].operationId);
 assert.equal((await ended(commits[0].operationId)).state,'succeeded');
 const plugin=(await call('/snapshot')).plugins[0];assert.equal(plugin.enabled,true);
 await writeFile(join(source,'worker.mjs'),`export default {apiVersion:'0.1',setup(){throw Error('PRIVATE_SETUP_DETAIL');}};`);
 const failed=await ended((await submit('prepare',{path:source,trusted:true})).operationId);assert.equal(failed.state,'failed');assert.equal(JSON.stringify(failed.error).includes('PRIVATE_SETUP_DETAIL'),false);
 assert.equal((await call('/snapshot')).plugins[0].generation,plugin.generation);assert.equal((await call('/plugins/fixture.lifecycle/invoke',{handler:'run'})).alive,true);
 await writeFile(join(source,'worker.mjs'),worker);
 const discarded=await ended((await submit('prepare',{path:source,trusted:true})).operationId);
 assert.equal((await ended((await submit('discard',{ticket:discarded.result.ticket})).operationId)).result.discarded,true);
 const expired=await ended((await submit('commit',{ticket:discarded.result.ticket})).operationId);assert.equal(expired.state,'failed');assert.equal(expired.error.code,'PLUGIN_CANDIDATE_EXPIRED');
 const disabled=await ended((await submit('disable',{id:plugin.id},'disable-once')).operationId);assert.equal(disabled.result.disabled,true);
 assert.equal((await submit('disable',{id:plugin.id},'disable-once')).operationId,disabled.id);assert.equal((await call('/snapshot')).plugins[0].enabled,false);
 const records=(await call('/operations')).operations;assert.ok(records.some(record=>record.kind==='plugin.lifecycle'));assert.equal(records.some(record=>'result' in record||'fingerprint' in record),false);
});

test('a lost lifecycle reply can be reconciled without a second worker',{timeout:20000},async t=>{
 const {connection,headers,source,counter,submit,ended,call}=await fixture(t);
 const input={path:source,trusted:true};
 await new Promise((resolve,reject)=>{const request=http.request(connection.url+'/v1/plugin-lifecycle/operations',{method:'POST',headers},response=>{try{assert.equal(response.statusCode,202);response.destroy();resolve();}catch(error){reject(error);}});request.on('error',reject);request.end(JSON.stringify({action:'prepare',input,key:'lost-reply'}));});
 const receipt=await submit('prepare',input,'lost-reply');const record=await ended(receipt.operationId);assert.equal(record.state,'succeeded');assert.equal(await readFile(counter,'utf8'),'x');
 const large=await ended((await submit('inspect',{path:source,padding:'x'.repeat(300000)})).operationId);assert.equal(large.state,'succeeded');
 await submit('inspect',{path:source,padding:'x'.repeat(550000)},'too-large',400);
 assert.ok((await call('/operations')).operations.some(item=>item.key==='lost-reply'));
});
