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
 await probe(`/sessions/${session.id}/messages`,409,'CONFLICT',{method:'POST',body:JSON.stringify({key:'conflict',text:'different'})});
 const success=await fetch(`${connection.url}/v1/snapshot`,{headers:{Authorization:`Bearer ${connection.token}`}});
 const snapshot=await success.json();assert.equal(success.status,200);assert.equal(snapshot.apiVersion,3);assert.equal(snapshot.error,undefined);
 assert.equal(snapshot.sessions[0].id,session.id);assert.ok(success.headers.get('x-vibeone-request-id'));
});
