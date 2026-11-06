import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTurns,activityTail} from '../apps/desktop/src/chat-timeline.js';

test('activity is grouped by Run, preserves intermediate replies in order, and never reassigns legacy tools',()=>{
 const session={status:'running',runs:[{id:'a',status:'completed'},{id:'b',status:'running'}],messages:[
  {id:'u1',role:'user',runId:'a',text:'first'},
  {id:'t1',role:'thought',runId:'a',text:'summary',activityOrder:2},
  {id:'n1',role:'assistant',runId:'a',text:'checking',activityOrder:3},
  {id:'a1',role:'assistant',runId:'a',text:'answer',activityOrder:5},
  {id:'u2',role:'user',runId:'b',text:'second'},
 ],tools:[{toolCallId:'old',title:'no recorded association'},{toolCallId:'tool1',runId:'a',title:'read',activityOrder:4}]};
 const turns=buildTurns(session),first=turns.find(t=>t.id==='a'),second=turns.find(t=>t.id==='b');
 assert.equal(first.reply.text,'answer');
 assert.deepEqual(first.activity.map(a=>a.type),['thought','tool']);
 assert.equal(second.live,true);
 assert.equal(first.live,false);
 assert.equal(second.activity.length,0);
 assert.equal(turns.find(t=>t.id==='legacy-tools').activity[0].item.toolCallId,'old');
});

test('rolling summary exposes the latest nonempty line and tail instead of the beginning of a growing thought',()=>{
 assert.equal(activityTail('old line\nlatest line\n'),'latest line');
 assert.equal(activityTail('abcdefghijk',5),'…ghijk');
 assert.equal(activityTail(''),'');
});

test('assistant commentary stays before its tools and the final reply follows them, including streaming updates',()=>{
 const session={status:'running',runs:[{id:'run',status:'running'}],messages:[
  {id:'u',role:'user',runId:'run',text:'search'},
  {id:'commentary',role:'assistant',runId:'run',text:'I will search first',activityOrder:2,updatedOrder:2},
 ],tools:[{toolCallId:'search',runId:'run',title:'Web search',status:'in_progress',activityOrder:3,updatedOrder:4}]};
 let turn=buildTurns(session)[0];
 assert.deepEqual(turn.blocks.map(block=>block.kind),['message','activity']);
 assert.equal(turn.blocks[0].message.id,'commentary');
 const activityId=turn.blocks[1].id;
 session.messages.push({id:'answer',role:'assistant',runId:'run',text:'Here is the news',activityOrder:5,updatedOrder:9});
 turn=buildTurns(session)[0];
 assert.deepEqual(turn.blocks.filter(block=>block.kind==='message').map(block=>block.message.id),['commentary','answer']);
 assert.ok(turn.blocks.findIndex(block=>block.id===activityId)<turn.blocks.findIndex(block=>block.message?.id==='answer'));
 assert.equal(turn.blocks.find(block=>block.id===activityId).live,false);
 // Finishing doesn't move the tool block or collapse an inspected block by changing its key.
 session.status='idle';session.runs[0].status='completed';
 assert.equal(buildTurns(session)[0].blocks.find(block=>block.kind==='activity').id,activityId);
});
