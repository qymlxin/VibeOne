import test from 'node:test';
import assert from 'node:assert/strict';
import {host} from './helpers/host.mjs';
import {applySync} from '../apps/desktop/src/workbench-sync.js';

test('cursor sync coalesces changed sessions and resets invalid cursors', {timeout:20000}, async t=>{
  const {directory,call,connection,wait}=await host(t);
  assert.equal((await fetch(`${connection.url}/v1/sync`)).status,401);
  const initial=await call('/sync');
  assert.equal(initial.version,1);
  assert.equal(initial.reset,'initial');
  assert.equal(initial.snapshot.revision,initial.cursor);
  const ids=await Promise.all(Array.from({length:4},()=>call('/sessions',{provider:'demo',workspace:directory})));
  const path=frame=>`/sync?epoch=${encodeURIComponent(frame.epoch)}&after=${frame.cursor}`;
  const created=await call(path(initial));
  assert.equal(created.reset,undefined);
  assert.deepEqual(new Set(created.events.map(event=>event.session.id)),new Set(ids.map(item=>item.id)));
  assert.equal(created.visibleSessionIds.length,4);
  assert(created.events.every(event=>event.type==='session.projected'&&event.cursor>initial.cursor&&event.cursor<=created.cursor));
  assert.equal(new Set(created.events.map(event=>event.id)).size,4);
  assert.equal(created.metadata.sessions,undefined);
  const quiet=await call(path(created));
  assert.deepEqual(quiet.events,[]);
  assert.equal(quiet.cursor,created.cursor);
  const id=ids[0].id;
  await call(`/sessions/${id}/messages`,{text:'cursor sync'});
  const ended=await wait(id,session=>session.stopReason==='end_turn');
  const updated=await call(path(created));
  assert.equal(updated.events.length,1,'many stream events coalesce to one current session projection');
  assert.deepEqual(updated.events[0].session,ended);
  const replay=await call(path(created));
  assert.deepEqual(replay.events,updated.events,'retries return stable event IDs and values');
  let projection=applySync(null,await call('/sync'));
  for(let round=0;round<8;round++){
    const writes=ids.map((item,index)=>call(`/sessions/${item.id}/metadata`,{title:`parallel-${round}-${index}`}));
    projection=applySync(projection,await call(`/sync?epoch=${projection.epoch}&after=${projection.cursor}`));
    await Promise.all(writes);
    projection=applySync(projection,await call(`/sync?epoch=${projection.epoch}&after=${projection.cursor}`));
    assert.deepEqual(projection.snapshot.sessions,(await call('/snapshot')).sessions,'concurrent commits must not leave a skipped session projection');
  }
  const future=await call(`/sync?epoch=${initial.epoch}&after=${projection.cursor+1}`);
  assert.equal(future.reset,'future');
  assert.equal(future.snapshot.sessions.length,4);
  const other=await call(`/sync?epoch=another-host&after=${updated.cursor}`);
  assert.equal(other.reset,'epoch');
  assert.equal(other.snapshot.revision,other.cursor);
});
