import test from 'node:test';import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';import {once} from 'node:events';import {readFile} from 'node:fs/promises';import {join,resolve} from 'node:path';import {setTimeout as sleep} from 'node:timers/promises';
import {host} from './helpers/host.mjs';import {updateSession} from '@vibeone/client-contracts';
test('metadata receipts never overwrite later titles or archive state and survive restart',{timeout:26000},async t=>{
 const {call,wait,directory,connection,exited}=await host(t);const {id}=await call('/sessions',{provider:'demo',workspace:directory});const base=`/sessions/${id}`;
 const first=updateSession(id,{title:'first',key:'title-first'}),later=updateSession(id,{title:'later',key:'title-later'}),archive=updateSession(id,{archived:true,key:'archive-first'});
 await call(...first);await call(...later);let count=(await call('/event-log?after=0')).events.filter(event=>event.kind==='session.metadata_updated').length;
 const receipts=await Promise.all(Array.from({length:6},()=>call(...first)));assert.ok(receipts.every(value=>value.updated===true));
 assert.equal((await call('/snapshot')).sessions.find(s=>s.id===id).title,'later');assert.equal((await call('/event-log?after=0')).events.filter(event=>event.kind==='session.metadata_updated').length,count);
 assert.equal((await call(...updateSession(id,{title:'changed',key:'title-first'}),false)).code,'IDEMPOTENCY_CONFLICT');
 await call(...archive);await call(...updateSession(id,{archived:false,key:'unarchive'}));await call(...archive);assert.equal((await call('/snapshot')).sessions.find(s=>s.id===id).archived,false);
 const second=await call('/sessions',{provider:'demo',workspace:directory});await call(...updateSession(second.id,{title:'different session',key:'title-first'}));
 for(const key of ['', 'x'.repeat(129)])assert.equal((await call(...updateSession(id,{title:'invalid',key}),false)).code,'INVALID_INPUT');
 await call(base+'/messages',{text:'/wait'});await wait(id,s=>s.status==='running');await call(...archive);
 const deferred=updateSession(id,{archived:true,key:'busy-archive'});assert.equal((await call(...deferred,false)).code,'SESSION_BUSY');
 await call(base+'/cancel',{});await wait(id,s=>s.status==='idle'&&s.stopReason==='cancelled');await call(...deferred);await call(...updateSession(id,{archived:false}));await call(...updateSession(id,{title:'legacy'}));
 assert.equal(JSON.stringify(await call('/snapshot')).includes('title-first'),false);
 await call('/host/stop',{});await exited;
 const child=spawn(resolve('target/debug/vibeone-host'),['serve','--data-dir',directory],{stdio:'ignore'}),done=once(child,'exit');let next;
 try {for(let i=0;i<150;i++){try{const d=JSON.parse(await readFile(join(directory,'host.json'),'utf8'));if(d.pid===child.pid){next=d;break;}}catch{}await sleep(25);}assert.ok(next);Object.assign(connection,next);
  count=(await call('/event-log?after=0')).events.filter(event=>event.kind==='session.metadata_updated').length;
  assert.deepEqual(await call(...first),{updated:true});assert.deepEqual(await call(...archive),{updated:true});const session=(await call('/snapshot')).sessions.find(s=>s.id===id);assert.equal(session.title,'legacy');assert.equal(session.archived,false);assert.equal((await call('/event-log?after=0')).events.filter(event=>event.kind==='session.metadata_updated').length,count);

  const database=join(directory,'vibeone.sqlite3');
  const stored=()=>JSON.parse(execFileSync('python3',['-c','import sqlite3,json,sys; db=sqlite3.connect(sys.argv[1]); print(json.dumps([db.execute("SELECT snapshot FROM sessions WHERE id=?",(sys.argv[2],)).fetchone()[0],db.execute("SELECT count(*) FROM catalog WHERE kind=\'metadata-command\'").fetchone()[0],db.execute("SELECT COALESCE(MAX(seq),0) FROM event_log").fetchone()[0]]))',database,id],{encoding:'utf8'}));
  const before=stored();
  execFileSync('python3',['-c',"import sqlite3,sys; db=sqlite3.connect(sys.argv[1]); db.execute(\"CREATE TRIGGER fail_metadata_receipt BEFORE INSERT ON catalog WHEN NEW.kind='metadata-command' BEGIN SELECT RAISE(ABORT,'injected receipt failure'); END\"); db.commit()",database]);
  assert.equal((await call(...updateSession(id,{title:'must roll back',key:'fault'}),false)).code,'STORAGE_UNAVAILABLE');
  assert.deepEqual(stored(),before,'projection, event and receipt must roll back as one transaction');
  assert.equal((await call('/snapshot')).sessions.find(s=>s.id===id).title,'legacy','failed commit cannot publish a cache-only title');
 }finally{if(next)await fetch(next.url+'/v1/host/stop',{method:'POST',headers:{Authorization:`Bearer ${next.token}`}}).catch(()=>{});const kill=setTimeout(()=>child.kill('SIGKILL'),8500);try{await done;}finally{clearTimeout(kill);}}
});
