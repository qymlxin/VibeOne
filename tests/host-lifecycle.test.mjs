import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {readFile,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import http from 'node:http';
import {setTimeout as sleep} from 'node:timers/promises';
import {host} from './helpers/host.mjs';

const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
const bounded=(promise,ms)=>Promise.race([promise,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('process did not finish within the budget')),ms);timer.unref();promise.finally(()=>clearTimeout(timer)).catch(()=>{});})]);
function socket(connection){
 return new Promise((resolve,reject)=>{
  const request=http.request(connection.url+'/v1/events',{headers:{Origin:'http://127.0.0.1:5174',Connection:'Upgrade',Upgrade:'websocket','Sec-WebSocket-Version':'13','Sec-WebSocket-Key':randomBytes(16).toString('base64')}});
  request.setTimeout(3000,()=>request.destroy(Error('WebSocket upgrade timed out')));request.on('error',reject);request.on('response',response=>{response.resume();reject(Error(`unexpected upgrade status ${response.statusCode}`));});
  request.on('upgrade',(response,stream,head)=>{
   let received=head;const timer=setTimeout(()=>{stream.destroy();reject(Error('WebSocket authentication timed out'));},3000);
   const data=chunk=>{received=Buffer.concat([received,chunk]);if(received.includes(Buffer.from('"ready"'))){clearTimeout(timer);stream.off('data',data);resolve(stream);}};
   stream.on('error',error=>{clearTimeout(timer);reject(error);});stream.on('data',data);
   const payload=Buffer.from(JSON.stringify({token:connection.token})),mask=randomBytes(4);assert.ok(payload.length<126);const masked=Buffer.from(payload);for(let i=0;i<masked.length;i++)masked[i]^=mask[i%4];stream.write(Buffer.concat([Buffer.from([0x81,0x80|payload.length]),mask,masked]));
  });request.end();
 });
}

test('single-instance startup preserves the private descriptor and authenticated loopback service',{timeout:18000},async t=>{
 const {directory,connection,call}=await host(t);
 assert.equal(new URL(connection.url).hostname,'127.0.0.1');assert.equal(connection.protocolVersion,2);
 const descriptor=await readFile(join(directory,'host.json'));
 if(process.platform!=='win32'){assert.equal((await stat(directory)).mode&0o077,0);assert.equal((await stat(join(directory,'host.json'))).mode&0o077,0);}
 const duplicate=spawn(resolve('target/debug/vibeone-host'),['serve','--data-dir',directory],{stdio:'ignore'});const exited=once(duplicate,'exit');t.after(()=>{if(duplicate.exitCode===null&&duplicate.signalCode===null)duplicate.kill('SIGKILL');});
 const [code]=await bounded(exited,4000);assert.notEqual(code,0);assert.deepEqual(await readFile(join(directory,'host.json')),descriptor);assert.equal(alive(connection.pid),true);
 assert.equal((await call('/snapshot')).protocolVersion,2);
 assert.equal((await fetch(connection.url+'/v1/snapshot')).status,401);
 assert.equal((await fetch(connection.url+'/v1/snapshot',{headers:{Authorization:`Bearer ${connection.token}`,Origin:'https://untrusted.example'}})).status,403);
});

test('a disconnected client does not stop work, while Host shutdown drains its process tree and preserves interruption',{timeout:28000,skip:process.platform==='win32'},async t=>{
 const {directory,connection,call,wait,child,exited}=await host(t);
 const profile=await call('/profiles',{name:'host lifecycle fixture',provider:'demo',args:[join(directory,'demo-agent.mjs'),'--stubborn']});
 const {id}=await call('/sessions',{provider:'demo',workspace:directory,profileId:profile.id});
 const stream=await socket(connection);t.after(()=>stream.destroy());
 const receipt=await call(`/sessions/${id}/messages`,{text:'/wait',key:'before-disconnect'});
 const running=await wait(id,session=>session.messages.some(message=>message.text?.startsWith('stubborn-child-pid:')));
 const descendant=Number(running.messages.find(message=>message.text?.startsWith('stubborn-child-pid:')).text.split(':')[1]);
 const agent=Number(execFileSync('ps',['-o','ppid=','-p',String(descendant)],{encoding:'utf8'}).trim());assert.ok(agent>0&&agent!==connection.pid);
 t.after(()=>{for(const pid of [descendant,agent])try{process.kill(pid,'SIGKILL');}catch{}});
 stream.destroy();await sleep(150);
 const detached=(await call('/snapshot')).sessions.find(session=>session.id===id);assert.equal(detached.status,'running');assert.equal(detached.runs.at(-1).id,receipt.operationId);assert.equal(alive(descendant),true);
 assert.equal((await call('/host/stop',{})).stopping,true);
 const [code,signal]=await bounded(exited,12000);assert.equal(code,0);assert.equal(signal,null);assert.equal(child.exitCode,0);
 for(let i=0;i<100&&(alive(descendant)||alive(agent));i++)await sleep(20);
 assert.equal(alive(descendant),false,'owned child must exit');assert.equal(alive(agent),false,'ACP parent must exit');
 await assert.rejects(readFile(join(directory,'host.json')),{code:'ENOENT'});
 const reopened=spawn(resolve('target/debug/vibeone-host'),['serve','--data-dir',directory],{stdio:'ignore'}),reopenedExit=once(reopened,'exit');let next;
 try{
  for(let i=0;i<120;i++){try{const value=JSON.parse(await readFile(join(directory,'host.json'),'utf8'));if(value.pid===reopened.pid){next=value;break;}}catch{}await sleep(25);}
  assert.ok(next,'the instance lock must be released');assert.notEqual(next.token,connection.token);
  const snapshot=await (await fetch(next.url+'/v1/snapshot',{headers:{Authorization:`Bearer ${next.token}`}})).json();const restored=snapshot.sessions.find(session=>session.id===id);
  assert.equal(restored.status,'interrupted');assert.equal(restored.runs.at(-1).status,'interrupted');assert.ok(restored.messages.some(message=>message.text==='/wait'));assert.equal(restored.approvals.length,0);
 }finally{
  if(next)await fetch(next.url+'/v1/host/stop',{method:'POST',headers:{Authorization:`Bearer ${next.token}`,'Content-Type':'application/json'},body:'{}'}).catch(()=>{});
  try{await bounded(reopenedExit,8500);}catch{reopened.kill('SIGKILL');await reopenedExit;}
 }
});
