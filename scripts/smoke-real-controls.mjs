// Explicit interactive smoke test against the authenticated real Codex adapter.
// It only requests writes inside an owned temporary workspace; no global config changes.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {createInterface} from 'node:readline/promises';
const data=await mkdtemp(join(tmpdir(),'vibeone-controls-host-'));
const workspace=await mkdtemp(join(tmpdir(),'vibeone-controls-workspace-'));
const child=spawn(resolve('target/debug/vibeone-host'),['serve','--data-dir',data],{stdio:'ignore'});
const exited=once(child,'exit');
const input=createInterface({input:process.stdin,output:process.stdout});
let connection,id,currentRun;
const report={provider:'codex',protocolVersion:2,checks:[]};
async function call(path,body,ok=true){
  const response=await fetch(`${connection.url}/v1${path}`,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${connection.token}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
  const result=await response.json();assert.equal(response.ok,ok,result.error);return result;
}
async function session(){return (await call('/snapshot')).sessions.find(s=>s.id===id);}
async function wait(predicate,label){
  const end=Date.now()+120000;let latest;
  while(Date.now()<end){latest=await session();if(predicate(latest))return latest;if(latest.error)throw Error(latest.error.slice(0,400));await sleep(200);}
  throw Error(`${label} timed out (${latest?.status}/${latest?.stopReason})`);
}
async function submit(text){
  currentRun=(await call(`/sessions/${id}/messages`,{text})).operationId;
  await wait(s=>s.runs.some(r=>r.id===currentRun&&r.status!=='queued'),'run start');
}
const active=s=>['starting','running','requires_action','cancelling'].includes(s.status);
async function terminal(){return wait(s=>!active(s)&&['end_turn','cancelled','error'].includes(s.stopReason),'terminal run');}
async function permission(kind){
  const state=await wait(s=>s.approvals.length||!active(s),'permission request');
  assert.ok(state.approvals.length,`Real agent ended without a permission request: ${JSON.stringify({status:state.status,stopReason:state.stopReason,reply:state.messages.filter(m=>m.role==='assistant').at(-1)?.text?.slice(0,800),tools:state.tools.map(t=>({title:t.title,status:t.status}))})}`);
  const request=state.approvals[0];
  console.log(JSON.stringify({stage:kind,request},null,2));
  const options=request.options??request.params?.options??[];
  const desired=kind==='approve'?'allow_once':'reject_once';
  const candidates=options.filter(o=>o.kind===desired);
  assert.ok(candidates.length,`Upstream did not supply ${desired}`);
  console.log(`Expected ${desired}; inspect the real action above. Enter one of: ${candidates.map(o=>o.optionId).join(', ')}`);
  const answer=(await input.question('Option ID (anything else aborts): ',{signal:AbortSignal.timeout(120000)})).trim();
  assert.ok(candidates.some(o=>o.optionId===answer),'No matching one-time choice; aborting');
  await call(`/sessions/${id}/approvals/${request.id}`,{option:answer});
  return request;
}
try{
  for(let i=0;i<150;i++){try{connection=JSON.parse(await readFile(join(data,'host.json'),'utf8'));break;}catch{await sleep(40);}}
  assert.ok(connection,'Host did not start');
  ({id}=await call('/sessions',{provider:'codex',workspace}));
  await submit('Reply exactly READY. Do not read, write, or use any tool.');
  await terminal();
  await call(`/sessions/${id}/configure`,{id:'mode',value:'read-only'});
  assert.equal((await session()).agentState.configOptions.find(o=>o.configId==='mode').currentValue,'read-only');
  if(!process.argv.includes('--input-only')){
  for(const kind of (process.argv.includes('--cancel-only')?[]:['approve','reject'])){
    const target=join(workspace,`${kind}.txt`);
    const command=`printf 'VIBEONE_${kind.toUpperCase()}_OK' > '${target}'`;
    await submit(`Permission integration test. Use the shell tool to execute exactly this command, with sandbox_permissions=require_escalated and a short justification, so the user can approve or reject it: ${command}\nDo not use apply_patch or any other command. Do not read other files or use network. If rejected, stop without retrying and reply DENIED.`);
    const request=await permission(kind);
    await terminal();
    if(kind==='approve')assert.equal(await readFile(target,'utf8'),'VIBEONE_APPROVE_OK');
    else await assert.rejects(readFile(target),{code:'ENOENT'});
    const opposite=request.options.find(option=>option.kind===(kind==='approve'?'reject_once':'allow_once'));
    assert.ok(opposite);
    await call(`/sessions/${id}/approvals/${request.id}`,{option:opposite.optionId},false);
    report.checks.push({name:kind,outcome:'passed',staleRejected:true});
    console.log(JSON.stringify(report.checks.at(-1)));
  }
  if(!process.argv.includes('--cancel-only')){
    const target=join(workspace,'cancel-pending.txt');
    await submit(`Use only the shell tool with sandbox_permissions=require_escalated to execute exactly: printf 'MUST_NOT_WRITE' > '${target}'. Request permission first; do not use apply_patch or retry after cancellation.`);
    const pending=await wait(s=>s.approvals.length||!active(s),'pending approval cancellation');
    assert.ok(pending.approvals.length,'Expected a real pending permission before stopping');
    const request=pending.approvals[0],allow=request.options.find(o=>o.kind==='allow_once');
    assert.ok(allow);
    await call(`/sessions/${id}/cancel`,{});
    await terminal();
    await call(`/sessions/${id}/approvals/${request.id}`,{option:allow.optionId},false);
    await assert.rejects(readFile(target),{code:'ENOENT'});
    report.checks.push({name:'cancel-pending-permission',outcome:'passed',staleRejected:true});
    console.log(JSON.stringify(report.checks.at(-1)));
  }
  const marker=`VIBEONE_CANCEL_${randomUUID().replaceAll('-','')}`;
  const command=`python3 -c 'import time; time.sleep(60)' ${marker}`;
  const matchingProcesses=()=>execFileSync('ps',['-axo','pid=,command='],{encoding:'utf8'}).split('\n').filter(line=>line.includes(marker));
  await submit(`Cancellation integration test. Run exactly this shell command: ${command}. Do not use network or read/write any file. Do not request elevated permissions. Wait for it to finish.`);
  await wait(s=>s.tools.some(t=>t.runId===currentRun&&t.status==='in_progress')||s.approvals.length||!active(s),'running command');
  const running=await session();
  assert.ok(active(running)&&!running.approvals.length&&running.tools.some(t=>t.runId===currentRun&&t.status==='in_progress'),'Expected actual running tool before cancellation');
  const processDeadline=Date.now()+5000;
  while(!matchingProcesses().length&&Date.now()<processDeadline)await sleep(50);
  assert.ok(matchingProcesses().length,'Owned long-running subprocess must actually exist');
  await call(`/sessions/${id}/cancel`,{});
  const cancelled=await terminal();assert.equal(cancelled.stopReason,'cancelled');
  assert.equal(cancelled.approvals.length,0);
  const cleanupDeadline=Date.now()+8000;
  while(matchingProcesses().length&&Date.now()<cleanupDeadline)await sleep(100);
  assert.equal(matchingProcesses().length,0,'Cancellation must terminate the owned tool subprocess');
  report.checks.push({name:'cancel',outcome:'passed',subprocessExited:true});
  await submit('Reply exactly VIBEONE_AFTER_CANCEL_OK. Do not use tools or read/write files.');
  const continued=await terminal();
  assert.ok(continued.messages.some(m=>m.runId===currentRun&&m.role==='assistant'&&m.text.includes('VIBEONE_AFTER_CANCEL_OK')));
  assert.equal(continued.agentState.configOptions.find(o=>o.configId==='mode').currentValue,'read-only');
  report.checks.push({name:'continue-with-restored-read-only-mode',outcome:'passed'});
  }
  if(!process.argv.includes('--cancel-only')){
    await call(`/sessions/${id}/configure`,{id:'collaboration_mode',value:'plan'});
    await submit('Structured input integration test. Do not read/write files or call shell/network tools. Use request_user_input to ask exactly one question with id=color, header=Color, question=Choose the test color, and two options labelled VIBEONE_BLUE and VIBEONE_GREEN. Wait for the structured answer, then include the selected label in your final response. Do not replace the structured question with plain chat text.');
    const waiting=await wait(s=>s.inputs.length||!active(s),'structured input');
    assert.ok(waiting.inputs.length,'Expected an actual elicitation/create request');
    const request=waiting.inputs[0];
    console.log(JSON.stringify({stage:'structured-input',mode:request.mode,schema:request.requestedSchema},null,2));
    assert.equal(request.mode,'form');
    const field=Object.entries(request.requestedSchema.properties).find(([,schema])=>schema.oneOf?.some(choice=>choice.const==='VIBEONE_BLUE'));
    assert.ok(field,'Expected the actual requested test choice');
    await call(`/sessions/${id}/inputs/${request.id}`,{action:'accept',content:{[field[0]]:'INVALID_CHOICE'}},false);
    await call(`/sessions/${id}/inputs/${request.id}`,{action:'accept',content:{[field[0]]:'VIBEONE_BLUE'}});
    const answered=await terminal();
    assert.ok(answered.messages.some(m=>m.runId===currentRun&&m.role==='assistant'&&m.text.includes('VIBEONE_BLUE')));
    await call(`/sessions/${id}/inputs/${request.id}`,{action:'decline'},false);
    report.checks.push({name:'structured-input',outcome:'passed',invalidAnswerRejected:true,staleRejected:true});
  }
  console.log(JSON.stringify(report,null,2));
}catch(error){report.error=String(error.message??error);console.error(JSON.stringify(report,null,2));process.exitCode=1;}
finally{
  await writeFile(join(tmpdir(),process.argv.includes('--input-only')?'vibeone-real-input-smoke.json':process.argv.includes('--cancel-only')?'vibeone-real-cancel-smoke.json':'vibeone-real-controls-smoke.json'),JSON.stringify(report,null,2));
  input.close();
  if(connection){if(id)await call(`/sessions/${id}/cancel`,{}).catch(()=>{});await call('/host/stop',{}).catch(()=>{});}else child.kill('SIGINT');
  const kill=setTimeout(()=>child.kill('SIGKILL'),8500);await exited;clearTimeout(kill);
  await rm(data,{recursive:true,force:true});await rm(workspace,{recursive:true,force:true});
}
