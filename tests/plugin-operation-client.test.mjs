import test from 'node:test';
import assert from 'node:assert/strict';
import {invokePluginOperation} from '../apps/desktop/src/plugin-operations.ts';
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

import {operationPresentation} from '../apps/desktop/src/plugin-operations.ts';
test('legacy operation metadata has clear labels without fabricated dates or states',()=>{
 assert.deepEqual(operationPresentation({state:'constructor'}),{title:'未知操作',plugin:'未知插件',time:'时间未知',state:'未知状态'});
 assert.equal(operationPresentation({state:'running',error:{code:'OPERATION_RECORD_INVALID'}}).state,'记录异常');
 assert.equal(operationPresentation({createdAt:null,state:'succeeded'}).time,'时间未知');
});

import {managePluginLifecycle} from '../apps/desktop/src/plugin-operations.ts';
test('lifecycle client waits on durable receipts and preserves old Host calls',async()=>{
 const calls=[];let refreshed=0;
 const result=await managePluginLifecycle({call:async(path,body)=>{calls.push([path,body]);return {operationId:'life'};},read:async path=>{assert.equal(path,'/operations/life');return {state:'succeeded',result:{ticket:'candidate'}};},refresh:async()=>{refreshed++;}},true,'prepare',{path:'/plugin',trusted:true},{key:'stable'});
 assert.deepEqual(result,{ticket:'candidate'});assert.equal(refreshed,1);assert.deepEqual(calls,[['/plugin-lifecycle/operations',{key:'stable',action:'prepare',input:{path:'/plugin',trusted:true}}]]);
 for(const action of ['inspect','prepare','commit','discard'])await managePluginLifecycle({call:async(path,body)=>{assert.equal(path,`/plugins/${action}`);assert.deepEqual(body,{ticket:'same'});return true;}},false,action,{ticket:'same'});
 await managePluginLifecycle({call:async(path,body)=>{assert.equal(path,'/plugins/plugin%20id/disable');assert.deepEqual(body,{});}},false,'disable',{id:'plugin id'});
});
