import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTurns,activityTail,groupProcess,formatDuration} from '../apps/desktop/src/chat-timeline.js';

test('activity is grouped by Run, preserves intermediate replies in order, and never reassigns legacy tools',()=>{
 const session={status:'running',runs:[{id:'a',status:'completed'},{id:'b',status:'running'}],messages:[
  {id:'u1',role:'user',runId:'a',text:'first'},
  {id:'t1',role:'thought',runId:'a',text:'summary',activityOrder:2},
  {id:'n1',role:'assistant',runId:'a',text:'checking',activityOrder:3},
  {id:'a1',role:'assistant',runId:'a',text:'answer',activityOrder:5},
  {id:'u2',role:'user',runId:'b',text:'second'},
 ],tools:[{toolCallId:'old',title:'no recorded association'},{toolCallId:'tool1',runId:'a',title:'read',activityOrder:4}]};
 const turns=buildTurns(session),first=turns.find(t=>t.id==='a'),second=turns.find(t=>t.id==='b');
 assert.equal(first.answer.text,'answer');
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
 assert.equal(turn.answer,null);
 assert.deepEqual(turn.process.map(event=>event.type),['note','tool']);
 const activityId=groupProcess(turn.process)[1].id;
 session.messages.push({id:'answer',role:'assistant',runId:'run',text:'Here is the news',activityOrder:5,updatedOrder:9});
 turn=buildTurns(session)[0];
 assert.equal(turn.answer.id,'answer');
 assert.deepEqual(turn.process.map(event=>event.type),['note','tool']);
 assert.equal(groupProcess(turn.process)[1].id,activityId);
 // Finishing doesn't move the tool block or collapse an inspected block by changing its key.
 session.status='idle';session.runs[0].status='completed';
 assert.equal(groupProcess(buildTurns(session)[0].process)[1].id,activityId);
});

test('nested groups combine only consecutive tools of the same family and retain notes and thoughts',()=>{
 const events=[{id:'n',type:'note',text:'explanation',item:{}},{id:'s1',type:'tool',item:{kind:'search'}},{id:'s2',type:'tool',item:{rawInput:{type:'webSearch',action:{type:'openPage',url:'https://example.com'}}}},{id:'t',type:'thought',text:'summary',item:{}},{id:'c',type:'tool',item:{rawInput:{command:'pwd'}}},{id:'s3',type:'tool',item:{kind:'search'}}];
 const groups=groupProcess(events);
 assert.deepEqual(groups.map(group=>group.type),['note','tools','thought','tools','tools']);
 assert.equal(groups[1].items.length,2);assert.equal(groups[1].family,'web');
 assert.equal(groups[3].family,'command');assert.equal(groups[4].items.length,1);
 assert.equal(formatDuration(272),'4 分 32 秒');
 const turn=buildTurns({status:'running',runs:[{id:'r',status:'running'}],messages:[{id:'u',role:'user',runId:'r'},{id:'t',role:'thought',runId:'r',text:'only a summary',activityOrder:2}],tools:[]})[0];
 assert.equal(turn.process.length,1);assert.equal(turn.answer,null);
});

test('accepted input replaces enriched agent echo without stripping user-authored text',()=>{
 const raw='[VibeOne 项目成员配置]\n你好';
 const turns=buildTurns({runs:[{id:'r',text:'你好'}],messages:[{id:'m',runId:'r',role:'user',text:raw}],tools:[]});
 assert.equal(turns[0].user.text,'你好');
 assert.equal(buildTurns({runs:[],messages:[{id:'m',role:'user',text:raw}],tools:[]})[0].user.text,raw);
});
