import test from 'node:test';
import assert from 'node:assert/strict';
import {invokePluginOperation} from '../apps/desktop/src/plugin-operations.js';
test('plugin Promise waits for durable terminal result and preserves false/null JSON',async()=>{
 for(const result of [false,null,0,{ok:true}]){
  const states=['accepted','running','succeeded'];let submitted=0,refreshed=0;
  const value=await invokePluginOperation({submit:async(id,body)=>{submitted++;assert.equal(body.key,'same');return {operationId:'op'};},read:async id=>{assert.equal(id,'op');return {state:states.shift(),result};},refresh:async()=>{refreshed++;}},'plugin',{handler:'test'},{key:'same',pause:async()=>{}});
  assert.deepEqual(value,result);assert.equal(submitted,1);assert.equal(refreshed,1);
 }
});
test('uncertain delivery never retries side effects and retains reconciliation identity',async()=>{
 let submits=0;
 await assert.rejects(invokePluginOperation({submit:async()=>{submits++;throw Error('network');}},'p',{}, {key:'known'}),error=>error.operationKey==='known');
 assert.equal(submits,1);
 await assert.rejects(invokePluginOperation({submit:async()=>({operationId:'accepted'}),read:async()=>{throw Error('offline');}},'p',{}, {key:'known'}),error=>error.operationId==='accepted');
 const rejection=Object.assign(Error('not authorized'),{status:403});
 await assert.rejects(invokePluginOperation({submit:async()=>{throw rejection;}},'p',{}, {key:'known'}),error=>error===rejection);
});
test('failed/interrupted operation exposes the receipt without a new submission',async()=>{
 for(const state of ['failed','interrupted'])await assert.rejects(invokePluginOperation({submit:async()=>({operationId:'op'}),read:async()=>({state,error:{code:'FAILED',message:'actual failure'}}),refresh:async()=>{}},'p',{}, {key:'known'}),error=>error.operationId==='op'&&error.code==='FAILED'&&error.message==='actual failure');
});
