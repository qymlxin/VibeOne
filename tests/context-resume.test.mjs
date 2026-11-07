import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as sleep} from 'node:timers/promises';

test('explicit upstream resume retains native memory and permissions, isolates replay and never falls back',{timeout:85000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'vibeone-context-resume-'));
 const database=join(directory,'native.json'),trace=join(directory,'native.trace');
 let child,exited,connection,browser,vite,page;
 const browserMode=process.env.VIBEONE_RESUME_BROWSER==='1';
 async function start(){
  child=spawn(resolve('target/debug/vibeone-host'),['serve','--data-dir',directory],{stdio:'ignore'});exited=once(child,'exit');
  for(let i=0;i<200;i++){try{const candidate=JSON.parse(await readFile(join(directory,'host.json'),'utf8'));if((await fetch(candidate.url+'/v1/health',{headers:{Authorization:`Bearer ${candidate.token}`}})).ok){connection=candidate;return;}}catch{}await sleep(25);}throw Error('Host did not start');
 }
 async function call(path,body,ok=true){const response=await fetch(connection.url+'/v1'+path,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${connection.token}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const value=await response.json();assert.equal(response.ok,ok,value.error);return value;}
 async function stop(){if(!child)return;await call('/host/stop',{}).catch(()=>{});const timer=setTimeout(()=>child.kill('SIGKILL'),8500);await exited;clearTimeout(timer);child=null;}
 t.after(async()=>{if(browser)await browser.close();vite?.kill();await stop();await rm(directory,{recursive:true,force:true});});
 const snapshot=()=>call('/snapshot');
 const session=async id=>(await snapshot()).sessions.find(item=>item.id===id);
 async function wait(id,predicate){for(let i=0;i<250;i++){const item=await session(id);if(predicate(item))return item;await sleep(25);}throw Error('Context state timed out: '+JSON.stringify(await session(id)));}
 const traces=async()=>{try{return (await readFile(trace,'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));}catch{return [];}};
 const resume=async id=>{const receipt=await call(`/sessions/${id}/context/resume`,{});assert.deepEqual(receipt,{resumeOnNextRun:true});return receipt;};
 const send=(id,text)=>call(`/sessions/${id}/messages`,{text,key:crypto.randomUUID()});
 await start();
 const profile=await call('/profiles',{name:'persistent agent',provider:'demo',command:process.execPath,args:[resolve('tests/fixtures/resume-agent.mjs'),database,trace]});
 const create=async name=>{const workspace=join(directory,name);await mkdir(workspace);return call('/sessions',{provider:'demo',workspace,profileId:profile.id});};
 const first=await create('first'),bad=await create('bad'),queued=await create('queued');
 assert.equal((await call(`/sessions/${first.id}/context/resume`,{},false)).code,'CONTEXT_CONFLICT');

 await send(first.id,'remember:original-memory');await wait(first.id,s=>s.runs.at(-1)?.status==='completed');
 await send(bad.id,'remember:bad-memory');await wait(bad.id,s=>s.runs.at(-1)?.status==='completed');
 await send(queued.id,'/wait');await wait(queued.id,s=>s.status==='running');
 await send(queued.id,'queued-native');
 const firstId=(await session(first.id)).agentState.upstreamSessionId,badId=(await session(bad.id)).agentState.upstreamSessionId;
 await stop();
 const native=JSON.parse(await readFile(database,'utf8'));native[firstId].mode='normal';native[badId].resumeBehavior='busy';await writeFile(database,JSON.stringify(native));
 await start();
 if(browserMode){
  const port=5174; // The production Host allows this explicit development origin.
  vite=spawn(process.execPath,[resolve('node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:resolve('apps/desktop'),stdio:'ignore'});
  const url=`http://127.0.0.1:${port}`;for(let i=0;i<150;i++){try{if((await fetch(url)).ok)break;}catch{}await sleep(25);}
  const {chromium}=await import('@playwright/test');browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE??(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined)});
  const context=await browser.newContext({viewport:{width:1360,height:900}});
  await context.addInitScript(connection=>{window.__TAURI_INTERNALS__={invoke:async command=>{if(command==='host_connection')return connection;if(command==='notification_permission')return {status:'denied'};throw Error('Unexpected test bridge');}};},connection);
  page=await context.newPage();await page.goto(url);await page.locator('.desktop-session').filter({hasText:'remember:original-memory'}).click();
  await page.getByRole('button',{name:'在原上下文继续',exact:true}).waitFor();
  assert.equal(await page.getByRole('textbox',{name:'发送任务'}).isDisabled(),true);
  await page.getByRole('combobox',{name:'主题',exact:true}).selectOption('dark');
  await page.screenshot({path:join(tmpdir(),'vibeone-context-resume-dark.png')});
  await page.getByRole('combobox',{name:'主题',exact:true}).selectOption('light');
  await page.screenshot({path:join(tmpdir(),'vibeone-context-resume-light.png')});
  await page.getByRole('combobox',{name:'主题',exact:true}).selectOption('dark');
 }
 assert.equal((await session(first.id)).historyOnly,true);
 const beforeChoice=(await traces()).length;
 if(page){await page.getByRole('button',{name:'在原上下文继续',exact:true}).click();await wait(first.id,s=>!s.historyOnly);}else await resume(first.id);
 assert.equal((await traces()).length,beforeChoice,'context selection does not create an agent');
 if(page){
  await page.waitForFunction(()=>document.querySelector('textarea[aria-label="发送任务"]')?.disabled===false);
  assert.equal(await page.getByRole('textbox',{name:'发送任务'}).isEnabled(),true);
  // Remote.jsx applies this mode for the phone surface; a native bridge fixture does not.
  await page.evaluate(()=>document.documentElement.classList.add('phone-mode'));
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(tmpdir(),'vibeone-context-resume-mobile.png')});
  assert.ok(await page.locator('.desktop-main').evaluate(node=>node.clientWidth>=380));
  assert.ok(await page.locator('.desktop-composer-wrap').evaluate(node=>node.scrollWidth<=node.clientWidth+1));
  await page.getByRole('textbox',{name:'发送任务'}).fill('recall');await page.getByRole('button',{name:'发送消息',exact:true}).click();
 }else await send(first.id,'recall');
 const resumed=await wait(first.id,s=>s.runs.length===2&&s.runs.at(-1)?.status==='completed');
 assert.equal(resumed.agentState.upstreamSessionId,firstId);assert.equal(resumed.agentState.contextRestoreState,'restored');
 assert.ok(resumed.messages.some(m=>m.role==='assistant'&&m.text==='memory:original-memory;mode:safe'));
 assert.equal(resumed.messages.some(m=>m.text?.includes('FORBIDDEN_SETUP_REPLAY')),false);
 const resumedTrace=(await traces()).slice(beforeChoice);
 assert.equal(resumedTrace.some(r=>r.method==='session/new'),false);
 assert.ok(resumedTrace.some(r=>r.method==='session/resume'&&r.sessionId===firstId&&r.replayFrom===null));
 assert.ok(resumedTrace.findIndex(r=>r.method==='session/set_config_option')<resumedTrace.findIndex(r=>r.method==='session/prompt'));
 const queueBefore=(await traces()).length;await resume(queued.id);
 assert.equal((await session(queued.id)).queuePaused,true);assert.equal((await traces()).length,queueBefore);
 await call(`/sessions/${queued.id}/queue`,{resume:true});
 await wait(queued.id,s=>s.runs.at(-1)?.status==='completed');
 assert.ok((await traces()).slice(queueBefore).some(r=>r.method==='session/prompt'&&r.text==='queued-native'));
 assert.equal((await traces()).slice(queueBefore).some(r=>r.method==='session/prompt'&&r.text==='/wait'),false);
 const beforeFailure=(await traces()).length;
 await resume(bad.id);await send(bad.id,'must-not-send');
 const failed=await wait(bad.id,s=>s.historyOnly&&s.agentState.contextRestoreState==='failed');
 assert.equal(failed.runs.at(-1).status,'failed');
 assert.equal((await traces()).slice(beforeFailure).some(r=>r.method==='session/prompt'||r.method==='session/new'),false,'busy resume must not prompt or silently create a substitute');
 if(page){
  await page.evaluate(()=>document.documentElement.classList.remove('phone-mode'));
  await page.setViewportSize({width:1360,height:900});await page.locator('.desktop-session').filter({hasText:'remember:bad-memory'}).click();
  await page.getByText('原上下文连接失败，本轮任务保留在失败记录，未自动改用新上下文。',{exact:true}).waitFor();
  await page.screenshot({path:join(tmpdir(),'vibeone-context-resume-failed.png')});
  await page.getByRole('button',{name:'在新上下文继续',exact:true}).click();await wait(bad.id,s=>!s.historyOnly);
  await page.getByRole('button',{name:'恢复失败任务到输入框（不会自动发送）',exact:true}).click();
  assert.equal(await page.getByRole('textbox',{name:'发送任务'}).inputValue(),'must-not-send');
  await page.getByRole('textbox',{name:'发送任务'}).fill('fresh choice');await page.getByRole('button',{name:'发送消息',exact:true}).click();
 }else{await call(`/sessions/${bad.id}/queue`,{resume:true,freshContext:true});await send(bad.id,'fresh choice');}
 const fresh=await wait(bad.id,s=>s.runs.at(-1)?.status==='completed');
 assert.notEqual(fresh.agentState.upstreamSessionId,badId);assert.equal(fresh.agentState.resumeSessionId,undefined);
 const latest=fresh.agentState.upstreamSessionId;
 if(browser){await browser.close();browser=null;}
 await stop();const changed=JSON.parse(await readFile(database,'utf8'));changed[latest].resumeBehavior='missing_state';await writeFile(database,JSON.stringify(changed));await start();
 const beforeMissing=(await traces()).length;
 await resume(bad.id);await send(bad.id,'no-state-must-not-send');await wait(bad.id,s=>s.historyOnly&&s.agentState.contextRestoreState==='failed');
 assert.equal((await traces()).slice(beforeMissing).some(r=>r.method==='session/prompt'||r.method==='session/new'),false);
 const deleted=JSON.parse(await readFile(database,'utf8'));delete deleted[latest];await writeFile(database,JSON.stringify(deleted));
 await resume(bad.id);await send(bad.id,'expired-must-not-send');
 const expired=await wait(bad.id,s=>s.historyOnly&&s.agentState.contextRestoreState==='failed');
 assert.match(expired.error,/不存在或已过期/);
 assert.equal((await traces()).slice(beforeMissing).some(r=>r.method==='session/prompt'||r.method==='session/new'),false);
});
