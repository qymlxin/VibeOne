import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {host} from './helpers/host.mjs';
import {savedModelOption,modelOptions} from '../apps/desktop/src/session-models.js';

test('model menu uses actual grouped options and isolates profiles',()=>{
 const option={type:'select',category:'model',configId:'selected_model',options:[{name:'Models',options:[{value:'actual',name:'Actual model'}]}]};
 const sessions=[{provider:'codex',profile:{id:'private'},agentState:{configOptions:[option]}},{provider:'codex',agentState:{configOptions:[option]}}];
 assert.equal(savedModelOption(sessions,'codex'),option);
 assert.equal(savedModelOption(sessions,'codex','other'),undefined);
 assert.deepEqual(modelOptions(option),[{value:'actual',label:'Actual model',description:'Models'}]);
});

test('catalog sends no task; initial model is durable, idempotent and applied before prompt',{timeout:30000},async t=>{
 const {directory,call,wait}=await host(t),log=join(directory,'requests.jsonl'),script=join(directory,'model-fixture.mjs');
 let source=await readFile('crates/agent-client/fixtures/demo-agent.mjs','utf8');
 source="import {appendFileSync} from 'node:fs';\n"+source.replace("configId:'mode'","configId:'model',category:'model'").replace("params.configId!=='mode'","params.configId!=='model'").replace('const message = JSON.parse(line);',`const message = JSON.parse(line);appendFileSync(${JSON.stringify(log)},JSON.stringify(message)+'\\n');`);
 await writeFile(script,source);
 const profile=await call('/profiles',{name:'Isolated model fixture',provider:'demo',command:process.execPath,args:[script]});
 const catalog=await call('/providers/demo/models',{workspace:directory,profileId:profile.id});
 assert.equal(catalog.configOptions[0].configId,'model');assert.equal((await call('/snapshot')).sessions.length,0);
 let requests=(await readFile(log,'utf8')).trim().split('\n').map(JSON.parse);assert.ok(!requests.some(r=>r.method==='session/prompt'));
 const body={provider:'demo',workspace:directory,profileId:profile.id,key:'model-intent',model:{id:'model',value:'normal'}};
 const {id}=await call('/sessions',body);assert.equal((await call('/sessions',body)).id,id);
 assert.equal((await call('/sessions',{...body,model:{id:'model',value:'safe'}},false)).code,'IDEMPOTENCY_CONFLICT');
 assert.deepEqual((await call('/snapshot')).sessions[0].agentState.initialModel,body.model);
 await call(`/sessions/${id}/messages`,{text:'hello'});const result=await wait(id,s=>s.runs?.at(-1)?.status==='completed');
 assert.equal(result.agentState.initialModel,undefined);assert.equal(result.agentState.configOptions[0].currentValue,'normal');
 requests=(await readFile(log,'utf8')).trim().split('\n').map(JSON.parse);
 const configured=requests.findIndex(r=>r.method==='session/set_config_option'),prompt=requests.findIndex(r=>r.method==='session/prompt');assert.ok(configured>=0&&prompt>configured);assert.equal(requests[configured].params.value,'normal');
 const bad=await call('/sessions',{...body,key:'unsupported-model',model:{id:'model',value:'missing'}});
 await call(`/sessions/${bad.id}/messages`,{text:'must not be sent'});
 const failed=await wait(bad.id,s=>s.runs?.at(-1)?.status==='failed');assert.equal(failed.agentState.initialModel.value,'missing');
 const after=(await readFile(log,'utf8')).trim().split('\n').map(JSON.parse);assert.equal(after.filter(r=>r.method==='session/prompt').length,1);
});
