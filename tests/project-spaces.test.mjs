import test from 'node:test';import assert from 'node:assert/strict';import{readFile,writeFile}from'node:fs/promises';import{join}from'node:path';import{host}from'./helpers/host.mjs';import{setTimeout as sleep}from'node:timers/promises';
test('project identity, display groups and bounded actual ACP handoff in isolated storage',{timeout:35000},async t=>{
 const{directory,call}=await host(t);await call('/projects',{id:'project-one',name:'Project One',addPath:directory});
 const existing=await call('/sessions',{provider:'demo',workspace:directory});
 const first=await call('/spaces',{action:'enter',projectId:'project-one'}),again=await call('/spaces',{action:'enter',projectId:'project-one'});assert.equal(first.steward.sessionId,again.steward.sessionId);
 assert.equal((await call('/spaces')).agents.filter(a=>a.steward).length,1);assert.ok((await call('/spaces')).agents.some(a=>a.sessionId===existing.id));
 assert.equal((await call('/spaces',{action:'agent-update',projectId:'project-one',id:first.steward.id,name:'Changed'},false)).code,'INVALID_INPUT');
 await call(`/sessions/${first.steward.sessionId}/metadata`,{title:'Changed'},false);
 const script=join(directory,'handoff.mjs');let source=await readFile('crates/agent-client/fixtures/demo-agent.mjs','utf8');source=source.replace('  for(const block of blocks){',"  response='成员职责确认完成';if(prompt.includes('START_HANDOFF'))response='转交给Beta。\\n```vibeone-handoff\\n'+JSON.stringify({to:'beta',message:'请说明你的职责'})+'\\n```';\n  for(const block of blocks){");await writeFile(script,source);
 const profile=await call('/profiles',{name:'Isolated routing fixture',provider:'demo',command:process.execPath,args:[script]});
 const alpha=await call('/spaces',{action:'agent',id:'alpha',projectId:'project-one',name:'Alpha',provider:'demo',profileId:profile.id,role:'负责分发'}),beta=await call('/spaces',{action:'agent',id:'beta',projectId:'project-one',name:'Beta',provider:'demo',profileId:profile.id,role:'负责回答'});
 await call('/spaces',{action:'display',projectId:'project-one',id:'engineering',name:'工程'});await call('/spaces',{action:'agent-update',projectId:'project-one',id:'alpha',groupId:'engineering'});
 const group=await call('/spaces',{action:'thread',projectId:'project-one',id:'group-intent',name:'Collaboration',members:[alpha.id,beta.id]});assert.notEqual(group.bindings.alpha,alpha.sessionId);assert.equal((await call('/spaces',{action:'thread',projectId:'project-one',id:'group-intent',name:'Collaboration',members:[alpha.id,beta.id]})).id,group.id);
 const body={action:'send',projectId:'project-one',id:group.id,key:'turn-one',text:'@Alpha START_HANDOFF'};await call('/spaces',body);await call('/spaces',body);assert.equal((await call('/spaces',{...body,text:"changed"},false)).code,"IDEMPOTENCY_CONFLICT");
 let latest;for(let i=0;i<150;i++){latest=(await call('/spaces')).threads.find(t=>t.id===group.id);if(latest.state!=='running')break;await sleep(80);}assert.equal(latest.state,'idle',latest.error);
 const snapshot=await call('/snapshot'),root=snapshot.sessions.find(s=>s.id===group.id);assert.equal(root.messages.filter(m=>m.role==='user').length,1);assert.ok(root.messages.some(m=>m.agentName==='Alpha'));assert.ok(root.messages.some(m=>m.agentName==='Beta'));
 const personal=snapshot.sessions.find(s=>s.id===alpha.sessionId);assert.equal(personal.messages.length,0,'group must not pollute personal context');
 await call('/projects',{id:'project-two',name:'Other Project'});await call('/spaces',{action:'agent',id:'alpha',projectId:'project-two',name:'Intruder',provider:'demo'},false);
});
