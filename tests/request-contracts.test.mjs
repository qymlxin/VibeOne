import test from 'node:test';
import assert from 'node:assert/strict';
import {host} from './helpers/host.mjs';
import {realpath} from 'node:fs/promises';
import {createSession,submitMessage,updateSession,importWorkspace,decideApproval} from '@vibeone/client-contracts';

test('generated-contract command builders control the actual Host and preserve receipt identity',{timeout:18000},async t=>{
 const {call,wait,directory}=await host(t);
 const workspace=await call(...importWorkspace(directory));assert.equal(workspace.path,await realpath(directory));
 const {id}=await call(...createSession('demo',directory));
 await call(...updateSession(id,{title:'typed commands'}));
 const command=submitMessage(id,'/approve',[],[],'generated-key');
 const accepted=await call(...command),duplicate=await call(...command);
 assert.equal(typeof accepted.operationId,'string');assert.equal(accepted.duplicate,false);
 assert.equal(duplicate.operationId,accepted.operationId);assert.equal(duplicate.duplicate,true);
 const pending=await wait(id,session=>session.approvals.length>0);
 const approval=pending.approvals[0];
 await call(...decideApproval(id,approval.id,approval.options[0].optionId));
 const ended=await wait(id,session=>session.stopReason==='end_turn');
 assert.equal(ended.title,'typed commands');assert.equal(ended.runs.length,1);
 assert.equal(ended.messages.filter(message=>message.role==='user').length,1);
});
