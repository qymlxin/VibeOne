import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotRecords,mergeHistory,historyBounds} from '../apps/desktop/src/conversation-history.ts';
import {buildTurns} from '../apps/desktop/src/chat-timeline.ts';
const message=(order,revision,fields={})=>({kind:'message',item:{id:`m${order}`,role:'assistant',text:'new',historyOrder:order,historyRevision:revision,...fields}});
test('archive merge preserves newer stream content and replaces pending identity at the same order',()=>{
 const pending=message(1,1,{id:'pending:r',role:'user',runId:'r',pending:true});
 const accepted=message(1,3,{id:'accepted',role:'user',runId:'r',pending:false});
 const updated=message(2,4,{text:'prefix + streamed suffix'});
 const cache=mergeHistory([pending], [accepted,updated]);
 const stale=mergeHistory(cache,[pending,message(2,2,{text:'prefix'})]);
 assert.equal(stale,cache);assert.equal(stale.length,2);
 assert.equal(stale[0].item.id,'accepted');assert.equal(stale[1].item.text,'prefix + streamed suffix');
 const tools={kind:'tool',item:{toolCallId:'t',historyOrder:3,historyRevision:5}};
 assert.deepEqual(historyBounds(mergeHistory(cache,[tools])),{first:1,last:3,continuous:true});
 assert.equal(historyBounds([message(1,1),message(3,1)]).continuous,false);
 assert.deepEqual(snapshotRecords({messages:[],tools:[tools.item]}),[tools]);
});
test('history grouping preserves a known tool-only Run, ordering, and unknown legacy role text',()=>{
 const session={status:'idle',runs:[],messages:[message(9,1,{runId:'new'}).item,{id:'legacy',role:'unknown',text:'unattributed text',historyOrder:3}],tools:[{toolCallId:'early',runId:'early',historyOrder:1}]};
 const turns=buildTurns(session);
 assert.equal(turns[0].id,'early');assert.equal(turns[0].process[0].item.toolCallId,'early');
 assert.ok(turns.some(turn=>turn.process.some(event=>event.unknownRole&&event.text==='unattributed text')));
 assert.equal(turns.find(turn=>turn.process.some(event=>event.unknownRole)).id,'legacy-messages');
 assert.equal(turns.at(-1).id,'new');
});
