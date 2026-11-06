import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {host} from './helpers/host.mjs';
import {setTimeout as sleep} from 'node:timers/promises';

function request(connection){return async(path,body,status=200,code)=>{
 const response=await fetch(connection.url+'/v1'+path,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${connection.token}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(4000)});
 const value=await response.json();assert.equal(response.status,status,JSON.stringify(value));
 if(code){assert.equal(value.code,code);assert.equal(value.status,status);assert.equal(value.requestId,response.headers.get('x-vibeone-request-id'));}
 return value;
};}
async function fixture(directory){
 const root=join(directory,'plugin');await mkdir(root);
 const manifest={manifestVersion:1,id:'test.errors',name:'Errors',version:'0.1.0',engines:{pluginApi:'>=0.1 <0.2'},entrypoints:{worker:{path:'worker.mjs',runtime:'node',protocolVersion:1}},contributions:[{id:'run',kind:'app.command',kindVersion:1,binding:{type:'worker',handler:'run'}}],hostRequirements:[],configurationSchema:{type:'object',properties:{count:{type:'integer'}}}};
 await writeFile(join(root,'plugin.json'),JSON.stringify(manifest));
 await writeFile(join(root,'worker.mjs'),"export default {apiVersion:'0.1',setup(r){r.handle('run',async input=>{if(input.fail)throw Error(input.secret);return {ok:true};});}};");
 return {root,manifest};
}

test('plugin configuration failures do not expose private values',{timeout:16000},async t=>{
 const {directory,connection}=await host(t),send=request(connection),{root}=await fixture(directory);
 const response=await fetch(connection.url+'/v1/plugins/prepare',{method:'POST',headers:{Authorization:`Bearer ${connection.token}`,'Content-Type':'application/json'},body:JSON.stringify({path:root,trusted:true,config:{count:'PRIVATE_CONFIG_VALUE'}})});
 assert.equal(response.status,400);const text=await response.text();assert.equal(text.includes('PRIVATE_CONFIG_VALUE'),false,text);
 const value=JSON.parse(text);assert.equal(value.code,'PLUGIN_CONFIGURATION_INVALID');
});

test('plugin lifecycle and operations reject conflicts with stable identities and sanitized Worker failures',{timeout:25000},async t=>{
 const {directory,connection,call}=await host(t),send=request(connection),{root,manifest}=await fixture(directory);
 await send('/plugins/prepare',{path:root,trusted:false},403,'PLUGIN_TRUST_REQUIRED');
 await send('/plugins/prepare',{path:root,trusted:true,expectedManifest:{}},409,'PLUGIN_MANIFEST_CHANGED');
 await send('/plugins/prepare',{path:root,trusted:true,workspaces:['missing']},403,'PLUGIN_PERMISSION_DENIED');
 const first=await send('/plugins/prepare',{path:root,trusted:true}),second=await send('/plugins/prepare',{path:root,trusted:true});
 await send('/plugins/commit',{ticket:first.ticket});
 await send('/plugins/commit',{ticket:second.ticket},409,'PLUGIN_GENERATION_CONFLICT');
 await send('/plugins/commit',{ticket:'missing'},409,'PLUGIN_CANDIDATE_EXPIRED');
 await send('/plugins/missing/disable',{},404,'PLUGIN_NOT_FOUND');
 await send('/plugins/missing/invoke',{handler:'run'},404,'PLUGIN_NOT_FOUND');
 const id=manifest.id;
 await send(`/plugins/${id}/invoke`,{handler:'not-published'},403,'PLUGIN_PERMISSION_DENIED');
 await send(`/plugins/${id}/invoke`,{handler:'run',generation:999},409,'PLUGIN_GENERATION_CONFLICT');
 await send(`/plugins/${id}/invoke`,{handler:'run',workspaceId:'missing'},403,'PLUGIN_PERMISSION_DENIED');
 const failure=await send(`/plugins/${id}/invoke`,{handler:'run',input:{fail:true,secret:'PRIVATE_WORKER_VALUE'}},502,'PLUGIN_OPERATION_FAILED');
 assert.equal(JSON.stringify(failure).includes('PRIVATE_WORKER_VALUE'),false);
 const body={key:'stable',handler:'run',input:{}};
 const receipt=await send(`/plugins/${id}/operations`,body,202);
 assert.equal((await send(`/plugins/${id}/operations`,body,202)).operationId,receipt.operationId);
 await send(`/plugins/${id}/operations`,{...body,input:{changed:true}},409,'IDEMPOTENCY_CONFLICT');
 const failed=await send(`/plugins/${id}/operations`,{key:'failed',handler:'run',input:{fail:true,secret:'PRIVATE_OPERATION_VALUE'}},202);
 let record;
 for(let i=0;i<100;i++){record=await send(`/operations/${failed.operationId}`);if(record.state==='failed')break;await sleep(20);}
 assert.equal(record.state,'failed');assert.equal(record.error.code,'PLUGIN_OPERATION_FAILED');assert.equal(JSON.stringify(record).includes('PRIVATE_OPERATION_VALUE'),false);
 await send('/operations/missing',undefined,404,'OPERATION_NOT_FOUND');
 await send(`/plugins/${id}/disable`,{});await send(`/plugins/${id}/invoke`,{handler:'run'},409,'PLUGIN_DISABLED');
 assert.equal(JSON.stringify((await call('/snapshot')).plugins).includes('PRIVATE_WORKER_VALUE'),false);
});
