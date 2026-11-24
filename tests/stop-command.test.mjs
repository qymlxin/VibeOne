import test from 'node:test';import assert from 'node:assert/strict';
import {activeRunForStop} from '../apps/desktop/src/use-stop-command.ts';
test('stop targets the active execution even when later queued or withdrawn records exist',()=>{
 const active={id:'active',status:'running',finishedAt:null};
 assert.equal(activeRunForStop({runs:[active,{id:'queued',status:'queued'},{id:'withdrawn',status:'withdrawn',finishedAt:9}]}),active);
 assert.equal(activeRunForStop({runs:[{id:'ended',status:'running',finishedAt:0}]}),undefined);
 assert.equal(activeRunForStop({runs:[]}),undefined);
 assert.equal(activeRunForStop({}),undefined);
});
