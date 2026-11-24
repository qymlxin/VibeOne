import test from 'node:test';
import assert from 'node:assert/strict';
import {HostRequestError} from '../apps/desktop/src/host-error.ts';
test('Host error identity retains dedicated/unknown codes and actual HTTP status',()=>{
 const error=new HostRequestError(404,{code:'FUTURE_EXTENSION_CODE',error:'保留主机说明',requestId:'request-id',status:200});
 assert(error instanceof Error);assert.equal(error.message,'保留主机说明');assert.equal(error.status,404);assert.equal(error.code,'FUTURE_EXTENSION_CODE');assert.equal(error.requestId,'request-id');
});
test('legacy or malformed errors keep stable status fallbacks without parsing translated text',()=>{
 assert.equal(new HostRequestError(401,{error:'旧主机说明'}).code,'UNAUTHENTICATED');
 assert.equal(new HostRequestError(409,{error:'a conflict in any language'}).code,'CONFLICT');
 assert.equal(new HostRequestError(503,null).code,'SERVICE_UNAVAILABLE');
 const error=new HostRequestError(500,{error:{unsafe:'object'},code:42,requestId:[]});
 assert.match(error.message,/500/);assert.equal(error.code,'INTERNAL_ERROR');assert.equal(error.requestId,null);
});
