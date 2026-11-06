// Opt-in real Codex memory test. Only disposable Host/workspace directories are used.
// No tool access is requested and no user Host or authentication is changed.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
const data=await mkdtemp(join(tmpdir(),'vibeone-real-resume-host-'));
const workspace=await mkdtemp(join(tmpdir(),'vibeone-real-resume-workspace-'));
const marker='VIBEONE_MEMORY_'+randomUUID().replaceAll('-','');
const report={provider:'codex',protocolVersion:2,checks:[]};
let child,exited,connection,id;
async function call(path,body){
 const response=await fetch(connection.url+'/v1'+path,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${connection.token}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
 const value=await response.json();assert.ok(response.ok,value.error);return value;
}
async function start(){
 child=spawn(resolve('target/debug/vibeone-host'),['serve','--data-dir',data],{stdio:'ignore'});exited=once(child,'exit');connection=null;
 for(let i=0;i<200;i++){try{const candidate=JSON.parse(await readFile(join(data,'host.json'),'utf8'));if((await fetch(candidate.url+'/v1/health',{headers:{Authorization:`Bearer ${candidate.token}`},signal:AbortSignal.timeout(1000)})).ok){connection=candidate;return;}}catch{}await sleep(30);}
 throw Error('Disposable Host failed to start');
}
async function stop(){
 if(!child)return;
 if(connection)await call('/host/stop',{}).catch(()=>{});else child.kill('SIGINT');
 const timer=setTimeout(()=>child.kill('SIGKILL'),8500);await exited;clearTimeout(timer);child=null;connection=null;
}
async function state(){return (await call('/snapshot')).sessions.find(item=>item.id===id);}
async function send(text){
 const {operationId}=await call(`/sessions/${id}/messages`,{text,key:randomUUID()});
 const deadline=Date.now()+120000;
 while(Date.now()<deadline){
  const view=await state(),run=view.runs.find(item=>item.id===operationId);
  assert.equal(view.approvals.length+view.inputs.length,0,'No human interaction was requested for this tool-free test');
  if(run?.status==='completed')return {view,run};
  assert.ok(!['failed','cancelled','interrupted'].includes(run?.status),'Real resume Run did not complete');
  await sleep(200);
 }
 throw Error('Real Agent timed out');
}
try{
 await start();({id}=await call('/sessions',{provider:'codex',workspace}));
 const initial=await send(`Remember this exact marker for the next turn: ${marker}. Reply only SAVED. Do not call any tool or read/write any file.`);
 const upstreamId=initial.view.agentState.upstreamSessionId;assert.ok(upstreamId);
 await call(`/sessions/${id}/configure`,{id:'mode',value:'read-only'});
 await stop();await start();
 const historical=await state();assert.equal(historical.historyOnly,true);
 const oldMessageIds=historical.messages.map(message=>message.id);
 await call(`/sessions/${id}/context/resume`,{});
 const pending=await state();assert.equal(pending.agentState.contextRestoreState,'pending');
 assert.equal(pending.agentState.upstreamSessionId,upstreamId);
 const restored=await send('Reply only with the exact marker I asked you to remember in the previous turn. Do not call tools or read/write files.');
 assert.equal(restored.view.agentState.upstreamSessionId,upstreamId);
 assert.equal(restored.view.agentState.contextRestoreState,'restored');
 assert.equal(restored.view.agentState.configOptions.find(option=>option.configId==='mode')?.currentValue,'read-only');
 assert.ok(restored.view.messages.some(message=>message.runId===restored.run.id&&message.role==='assistant'&&message.text.includes(marker)),'Native Agent memory must contain the marker absent from the second prompt');
 for(const messageId of oldMessageIds)assert.equal(restored.view.messages.filter(message=>message.id===messageId).length,1);
 assert.equal(restored.view.tools.length,0,'Tool-free prompts must not execute tools');
 report.checks=['host-process-restart','same-upstream-identity','native-memory','read-only-restored','no-local-history-duplicates','no-tools'].map(name=>({name,outcome:'passed'}));
 console.log(JSON.stringify(report,null,2));
}catch(error){report.error=String(error.message??error);console.error(JSON.stringify(report,null,2));process.exitCode=1;}
finally{
 if(connection&&id)await call(`/sessions/${id}/cancel`,{}).catch(()=>{});
 await stop();await writeFile(join(tmpdir(),'vibeone-real-context-resume.json'),JSON.stringify(report,null,2));
 await rm(data,{recursive:true,force:true});await rm(workspace,{recursive:true,force:true});
}
