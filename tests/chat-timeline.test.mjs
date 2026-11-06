import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTurns,activityTail} from '../apps/desktop/src/chat-timeline.js';

test('activity is grouped by Run, keeps intermediate replies inspectable, and never reassigns legacy tools',()=>{
 const session={status:'running',runs:[{id:'a',status:'completed'},{id:'b',status:'running'}],messages:[
  {id:'u1',role:'user',runId:'a',text:'first'},
  {id:'t1',role:'thought',runId:'a',text:'summary',activityOrder:2},
  {id:'n1',role:'assistant',runId:'a',text:'checking',activityOrder:3},
  {id:'a1',role:'assistant',runId:'a',text:'answer',activityOrder:5},
  {id:'u2',role:'user',runId:'b',text:'second'},
 ],tools:[{toolCallId:'old',title:'no recorded association'},{toolCallId:'tool1',runId:'a',title:'read',activityOrder:4}]};
 const turns=buildTurns(session),first=turns.find(t=>t.id==='a'),second=turns.find(t=>t.id==='b');
 assert.equal(first.reply.text,'answer');
 assert.deepEqual(first.activity.map(a=>a.type),['thought','note','tool']);
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
