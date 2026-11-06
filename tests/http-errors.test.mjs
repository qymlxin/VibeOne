import test from 'node:test';
import assert from 'node:assert/strict';
import {host} from './helpers/host.mjs';

test('HTTP failures share a typed JSON envelope without changing successful payloads',{timeout:18000},async t=>{
 const {connection,call,directory}=await host(t);
 const ids=new Set();
 const probe=async(path,status,code,{auth=true,method='GET',body,contentType='application/json',origin}={})=>{
  const response=await fetch(`${connection.url}/v1${path}`,{method,headers:{...(auth?{Authorization:`Bearer ${connection.token}`} :{}),...(contentType?{'Content-Type':contentType}:{}),'x-vibeone-request-id':'client-must-not-choose',...(origin?{Origin:origin}:{})},...(body===undefined?{}:{body})});
  assert.equal(response.status,status,path);assert.match(response.headers.get('content-type'),/application\/json/);
  const error=await response.json();
  assert.equal(error.code,code,path);assert.equal(error.status,status);assert.equal(typeof error.error,'string');assert(error.error.length>0);
  assert.match(error.requestId,/^[0-9a-f]{8}-[0-9a-f-]{27}$/);
  assert.equal(response.headers.get('x-vibeone-request-id'),error.requestId);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(ids.has(error.requestId),false);ids.add(error.requestId);
  assert.equal(JSON.stringify(error).includes(connection.token),false);
  return response;
 };
 await probe('/snapshot',401,'UNAUTHENTICATED',{auth:false});
 await probe('/snapshot',403,'FORBIDDEN',{origin:'https://untrusted.example'});
 await probe('/not-a-route',404,'NOT_FOUND');
 const method=await probe('/snapshot',405,'METHOD_NOT_ALLOWED',{method:'POST',body:'{}'});assert.match(method.headers.get('allow'),/GET/);
 await probe('/sessions',415,'UNSUPPORTED_MEDIA_TYPE',{method:'POST',body:'{}',contentType:null});
 await probe('/sessions',400,'INVALID_REQUEST',{method:'POST',body:'{broken'});
 await probe('/sessions',422,'VALIDATION_FAILED',{method:'POST',body:'{}'});
 await probe('/sessions',413,'PAYLOAD_TOO_LARGE',{method:'POST',body:JSON.stringify({provider:'demo',workspace:'x'.repeat(300000)})});
 await probe('/event-log?after=not-a-cursor',400,'INVALID_REQUEST');
 await probe('/operations/missing',404,'OPERATION_NOT_FOUND');
 const session=await call('/sessions',{provider:'demo',workspace:directory});
 await call(`/sessions/${session.id}/messages`,{key:'conflict',text:'first'});
 await probe(`/sessions/${session.id}/messages`,409,'IDEMPOTENCY_CONFLICT',{method:'POST',body:JSON.stringify({key:'conflict',text:'different'})});
 const success=await fetch(`${connection.url}/v1/snapshot`,{headers:{Authorization:`Bearer ${connection.token}`}});
 const snapshot=await success.json();assert.equal(success.status,200);assert.equal(snapshot.apiVersion,3);assert.equal(snapshot.error,undefined);
 assert.equal(snapshot.sessions[0].id,session.id);assert.ok(success.headers.get('x-vibeone-request-id'));
});

test('catalog domain failures expose stable identities and preserve stale-update protection',{timeout:18000},async t=>{
 const {connection,call,directory}=await host(t);
 const failure=async(path,body,status,code)=>{
  const response=await fetch(`${connection.url}/v1${path}`,{method:'POST',headers:{Authorization:`Bearer ${connection.token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const result=await response.json();assert.equal(response.status,status,JSON.stringify(result));assert.equal(result.code,code);assert.equal(result.status,status);
  assert.equal(response.headers.get('x-vibeone-request-id'),result.requestId);
  return result;
 };
 await failure('/profiles',{id:'missing',remove:true},404,'PROFILE_NOT_FOUND');
 await failure('/profiles',{name:'',provider:'demo'},400,'INVALID_INPUT');
 await failure('/workspaces',{path:directory+'/does-not-exist'},404,'WORKSPACE_NOT_FOUND');
 await failure('/workspaces',{path:directory+'/host.json'},400,'INVALID_INPUT');
 const profile=await call('/profiles',{name:'first',provider:'demo'});
 const next=await call('/profiles',{id:profile.id,revision:1,name:'next',provider:'demo'});
 await failure('/profiles',{id:profile.id,revision:1,name:'stale',provider:'demo'},409,'PROFILE_CONFLICT');
 await failure('/profiles',{id:profile.id,revision:next.revision,recordHash:'incorrect',remove:true},409,'PROFILE_CONFLICT');
 assert.equal((await call('/snapshot')).profiles.find(item=>item.id===profile.id).name,'next');
 await call('/profiles',{id:profile.id,revision:next.revision,remove:true});
 await failure('/profiles',{id:profile.id,remove:true},404,'PROFILE_NOT_FOUND');
 for(let index=0;index<64;index++)await call('/profiles',{name:`limit ${index}`,provider:'demo'});
 await failure('/profiles',{name:'overflow',provider:'demo'},409,'PROFILE_LIMIT_REACHED');
});

test('execution domain failures reject work with stable codes before creating receipts',{timeout:22000},async t=>{
 const {connection,call,directory,wait}=await host(t);
 const failure=async(path,body,status,code)=>{
  const response=await fetch(connection.url+'/v1'+path,{method:'POST',headers:{Authorization:`Bearer ${connection.token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const value=await response.json();assert.equal(response.status,status,JSON.stringify(value));assert.equal(value.code,code);assert.equal(value.status,status);
  assert.equal(response.headers.get('x-vibeone-request-id'),value.requestId);return value;
 };
 const first=await call('/sessions',{provider:'demo',workspace:directory});
 const other=await call('/sessions',{provider:'demo',workspace:directory});
 const path=`/sessions/${first.id}`;
 await failure('/sessions/missing/messages',{text:'no'},404,'SESSION_NOT_FOUND');
 await failure('/sessions/missing/cancel',{},404,'SESSION_NOT_FOUND');
 await failure('/sessions/missing/queue',{pause:true},404,'SESSION_NOT_FOUND');
 await failure(path+'/messages',{text:''},400,'INVALID_INPUT');
 await failure(path+'/messages',{text:'no',key:''},400,'INVALID_INPUT');
 await failure(path+'/messages',{text:'no',files:['../outside']},400,'INVALID_REFERENCE');
 await failure(path+'/messages',{text:'no',attachments:['missing']},400,'INVALID_ATTACHMENT');
 await failure(path+'/queue',{pause:true,resume:true},400,'INVALID_INPUT');
 await failure(path+'/queue',{pause:true},409,'QUEUE_CONFLICT');
 await failure(path+'/queue',{withdraw:'missing'},409,'QUEUE_CONFLICT');
 assert.equal((await call('/snapshot')).sessions.find(item=>item.id===first.id).runs.length,0);
 await call(path+'/queue',{resume:true,freshContext:true});
 assert.equal((await call('/snapshot')).sessions.find(item=>item.id===first.id).runs.length,0,'fresh selection before ACP initialization does not panic or start work');
 await call(path+'/metadata',{archived:true});
 await failure(path+'/messages',{text:'no'},409,'SESSION_UNAVAILABLE');
 await call(path+'/metadata',{archived:false});
 const accepted=await call(path+'/messages',{text:'/wait',key:'owned'});
 await wait(first.id,item=>item.status==='running');
 const duplicate=await call(path+'/messages',{text:'/wait',key:'owned'});
 assert.equal(duplicate.operationId,accepted.operationId);assert.equal(duplicate.duplicate,true);
 await failure(path+'/messages',{text:'different',key:'owned'},409,'IDEMPOTENCY_CONFLICT');
 await failure(`/sessions/${other.id}/messages`,{text:'blocked'},409,'WORKSPACE_BUSY');
 assert.equal((await call('/snapshot')).sessions.find(item=>item.id===other.id).runs.length,0);
 for(let index=0;index<20;index++)await call(path+'/messages',{text:`queued ${index}`});
 await failure(path+'/messages',{text:'overflow'},409,'RUN_LIMIT_REACHED');
 await call(path+'/cancel',{});await wait(first.id,item=>item.status==='idle'&&item.stopReason==='cancelled'&&item.queuePaused);
});

test('human decisions and session controls expose typed conflicts without consuming invalid answers',{timeout:25000},async t=>{
 const {connection,call,directory,wait}=await host(t);
 const failure=async(path,body,status,code)=>{
  const response=await fetch(connection.url+'/v1'+path,{method:'POST',headers:{Authorization:`Bearer ${connection.token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const value=await response.json();assert.equal(response.status,status,JSON.stringify(value));assert.equal(value.code,code);assert.equal(value.status,status);return value;
 };
 for(const suffix of ['approvals/none','inputs/none','configure','metadata']){
  await failure('/sessions/missing/'+suffix,suffix==='configure'?{id:'mode',value:'safe'}:suffix==='metadata'?{title:'new'}:suffix.startsWith('inputs')?{action:'cancel'}:{option:'allow'},404,'SESSION_NOT_FOUND');
 }
 const {id}=await call('/sessions',{provider:'demo',workspace:directory});const base=`/sessions/${id}`;
 await failure(base+'/metadata',{title:' '},400,'INVALID_INPUT');
 const send=async text=>{const result=await call(base+'/messages',{text});return result.operationId;};
 const ended=runId=>wait(id,s=>s.runs.some(run=>run.id===runId&&run.status==='completed'));
 await ended(await send('warmup'));
 await failure(base+'/configure',{id:'missing',value:'safe'},400,'CONFIGURATION_UNSUPPORTED');
 await failure(base+'/configure',{id:'mode',value:'private-invalid-choice'},400,'INVALID_CONFIGURATION');
 await call(base+'/configure',{id:'mode',value:'normal'});
 const approvedRun=await send('/approve');const approval=(await wait(id,s=>s.approvals.length===1)).approvals[0];
 await failure(base+'/configure',{id:'mode',value:'safe'},409,'CONFIGURATION_BUSY');
 await failure(base+'/metadata',{archived:true},409,'SESSION_BUSY');
 await failure(base+`/approvals/${approval.id}`,{option:'not-advertised'},400,'INVALID_DECISION');
 assert.equal((await call('/snapshot')).sessions.find(s=>s.id===id).approvals.length,1);
 await call(base+`/approvals/${approval.id}`,{option:'allow'});
 await call(base+`/approvals/${approval.id}`,{option:'allow'});
 await failure(base+`/approvals/${approval.id}`,{option:'reject'},409,'DECISION_CONFLICT');
 await ended(approvedRun);
 const inputRun=await send('/input');const input=(await wait(id,s=>s.inputs.length===1)).inputs[0];
 const invalid=await failure(base+`/inputs/${input.id}`,{action:'accept',content:{name:{secret:'PRIVATE_ANSWER_MARKER'}}},400,'INVALID_ANSWER');
 assert.equal(JSON.stringify(invalid).includes('PRIVATE_ANSWER_MARKER'),false);
 assert.equal((await call('/snapshot')).sessions.find(s=>s.id===id).inputs.length,1);
 const answer={action:'accept',content:{name:'valid-name'}};
 await call(base+`/inputs/${input.id}`,answer);await call(base+`/inputs/${input.id}`,answer);
 await failure(base+`/inputs/${input.id}`,{action:'cancel'},409,'DECISION_CONFLICT');
 const answered=await ended(inputRun);assert.equal(answered.decisions.filter(item=>item.requestId===input.id).length,1);
 await send('/input');const abandoned=(await wait(id,s=>s.inputs.length===1)).inputs[0];
 await call(base+'/cancel',{});await wait(id,s=>s.status==='idle'&&s.stopReason==='cancelled');
 await failure(base+`/inputs/${abandoned.id}`,answer,409,'ATTENTION_EXPIRED');
 await failure(base+'/approvals/missing',{option:'allow'},409,'ATTENTION_EXPIRED');
 await call(base+'/metadata',{archived:true});
 await failure(base+'/configure',{id:'mode',value:'safe'},409,'CONFIGURATION_BUSY');
 const {resolve}=await import('node:path');
 const profile=await call('/profiles',{name:'reject-config',provider:'demo',command:process.execPath,args:[resolve('crates/agent-client/fixtures/demo-agent.mjs'),'--reject-config']});
 const other=await call('/sessions',{provider:'demo',workspace:directory,profileId:profile.id});
 const receipt=await call(`/sessions/${other.id}/messages`,{text:'warmup'});
 await wait(other.id,s=>s.runs.some(run=>run.id===receipt.operationId&&run.status==='completed'));
 const rejected=await failure(`/sessions/${other.id}/configure`,{id:'mode',value:'normal'},502,'CONFIGURATION_FAILED');
 assert.equal(JSON.stringify(rejected).includes('Fixture rejected'),false);
});

test('accepted configuration survives HTTP disconnect and blocks conflicting writes while waiting for ACP',{timeout:18000},async t=>{
 const {join,resolve}=await import('node:path');
 const {readFile,writeFile}=await import('node:fs/promises');
 const {setTimeout:sleep}=await import('node:timers/promises');
 const {connection,call,directory,wait}=await host(t);
 const trace=join(directory,'config.trace'),release=join(directory,'config.release');
 const profile=await call('/profiles',{name:'gated-config',provider:'demo',command:process.execPath,args:[resolve('tests/fixtures/config-gated-agent.mjs'),trace,release]});
 const {id}=await call('/sessions',{provider:'demo',workspace:directory,profileId:profile.id});
 const {operationId}=await call(`/sessions/${id}/messages`,{text:'warmup'});
 await wait(id,s=>s.runs.some(run=>run.id===operationId&&run.status==='completed'));
 const controller=new AbortController();
 const pending=fetch(connection.url+`/v1/sessions/${id}/configure`,{method:'POST',headers:{Authorization:`Bearer ${connection.token}`,'Content-Type':'application/json'},body:JSON.stringify({id:'mode',value:'normal'}),signal:controller.signal}).then(response=>({status:response.status}),()=>({aborted:true}));
 t.after(()=>controller.abort());
 let seen=false;for(let attempt=0;attempt<150;attempt++){try{seen=(await readFile(trace,'utf8')).includes('normal');if(seen)break;}catch{}await sleep(20);}
 assert.ok(seen,'Agent must actually receive configuration before the client disconnects');
 for(const [suffix,body,code] of [['configure',{id:'mode',value:'safe'},'CONFIGURATION_BUSY'],['messages',{text:'must-not-run'},'CONFIGURATION_BUSY'],['metadata',{archived:true},'SESSION_BUSY']]){
  const response=await fetch(connection.url+`/v1/sessions/${id}/`+suffix,{method:'POST',headers:{Authorization:`Bearer ${connection.token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal(response.status,409);assert.equal((await response.json()).code,code);
 }
 controller.abort();assert.equal((await pending).aborted,true);
 await writeFile(release,'release');
 const updated=await wait(id,s=>s.agentState.configOptions.some(option=>option.configId==='mode'&&option.currentValue==='normal'));
 assert.equal(updated.runs.length,1);assert.equal(updated.archived,false);
 assert.equal((await readFile(trace,'utf8')).trim().split('\n').length,1,'configuration is delivered once');
});
