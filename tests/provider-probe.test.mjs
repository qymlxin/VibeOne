import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,readFile,access,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {host} from './helpers/host.mjs';
import {probeProvider} from '@vibeone/client-contracts';

test('provider probes initialize only, bound lifetime, isolate private output and leave sessions untouched',{timeout:30000},async t=>{
 const {call,directory}=await host(t);
 const builtin=await call(...probeProvider('demo'));
 assert.equal(builtin.capabilities.session,true,'v2 session capability covers baseline lifecycle, not a legacy load flag');
 assert.equal(builtin.state,'ready');assert.equal(builtin.version,'0.1.0');assert.equal(builtin.authentication,'not_required');
 const script=join(directory,'probe-fixture.mjs'),marker=join(directory,'must-not-open-session');
 await writeFile(script,`import readline from 'node:readline';import fs from 'node:fs';import {spawn} from 'node:child_process';
const mode=process.argv[2],marker=process.argv[3];
for await(const line of readline.createInterface({input:process.stdin})){
 const request=JSON.parse(line);
 if(request.method!=='initialize'){fs.writeFileSync(marker,'unexpected session or prompt');process.exit(2);}
 if(mode==='timeout'){const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(marker+'.pid',String(child.pid));continue;}
 if(mode==='auth'){console.log(JSON.stringify({jsonrpc:'2.0',id:request.id,error:{code:-32000,message:'PRIVATE_AUTH_TOKEN_SHOULD_NOT_LEAK'}}));continue;}
 process.stderr.write('PRIVATE_STDERR_SHOULD_NOT_LEAK');
 console.log(JSON.stringify({jsonrpc:'2.0',id:request.id,result:{protocolVersion:mode==='v1'?1:2,agentCapabilities:{},info:{name:'fixture',version:'9.8.7',secret:'PRIVATE_INFO_SHOULD_NOT_LEAK'},capabilities:{session:{prompt:{image:{},embeddedContext:{}}},private:'PRIVATE_CAPABILITY_SHOULD_NOT_LEAK'}}}));
}`);
 const profile=async mode=>call('/profiles',{name:`probe ${mode}`,provider:'demo',command:process.execPath,args:[script,mode,marker]});
 for(const [mode,state] of [['ready','ready'],['v1','incompatible'],['auth','authentication_required']]){
  const saved=await profile(mode),result=await call(...probeProvider('demo',saved.id));
  assert.equal(result.state,state,JSON.stringify(result));assert.equal(result.profileRevision,1);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE_|probe-fixture|must-not-open/);
  assert.equal(result.authentication,mode==='auth'?'not_authenticated':'unknown');
 }
 await assert.rejects(access(marker));
 const invalid=await call(...probeProvider('demo','missing'),false);assert.equal(invalid.code,'PROFILE_NOT_FOUND');
 const slow=await profile('timeout');
 const pending=call(...probeProvider('demo',slow.id));
 let pid;for(let i=0;i<100;i++){try{pid=Number(await readFile(marker+'.pid','utf8'));break;}catch{await sleep(20);}}
 assert.ok(pid,'timeout fixture launched its child');
 assert.equal((await call(...probeProvider('demo'),false)).code,'PROBE_BUSY');
 assert.equal((await pending).state,'timed_out');
 let alive=true;for(let i=0;i<100;i++){try{process.kill(pid,0);}catch{alive=false;break;}await sleep(20);}
 assert.equal(alive,false,'timed out probe must drain its child group');
 assert.equal((await call(...probeProvider('demo'))).state,'ready','a completed timeout releases the probe gate');
 const removed=join(directory,'removed-program');await writeFile(removed,'fixture');
 const missing=await call('/profiles',{name:'missing program',provider:'demo',command:removed});await rm(removed);
 assert.equal((await call(...probeProvider('demo',missing.id))).state,'not_installed');
 const snapshot=await call('/snapshot');assert.equal(snapshot.sessions.length,0,'probe never creates a workbench session');
});
