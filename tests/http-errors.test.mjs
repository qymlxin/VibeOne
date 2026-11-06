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
