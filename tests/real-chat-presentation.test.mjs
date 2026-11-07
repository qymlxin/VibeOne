// Explicit real Codex acceptance; intentionally excluded from the default unit suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as sleep} from 'node:timers/promises';
import {chromium} from '@playwright/test';
import {host} from './helpers/host.mjs';

test('real Codex: round disclosure, nested file reads and prototype change row',{timeout:180000},async t=>{
 const h=await host(t);const workspace=join(h.directory,'project');await mkdir(workspace);const git=(...args)=>execFileSync('git',['-C',workspace,...args],{stdio:'ignore'});
 git('init');await writeFile(join(workspace,'one.md'),'# One\nAlpha acceptance text.\n');await writeFile(join(workspace,'two.md'),'# Two\nBeta acceptance text.\n');git('add','one.md','two.md');git('-c','user.name=Acceptance','-c','user.email=test@example.com','commit','-m','fixture');
 const {id}=await h.call('/sessions',{provider:'codex',workspace});
 await h.call(`/sessions/${id}/messages`,{text:'请先用一句中文说明计划，然后分别用两次独立命令 cat one.md 和 cat two.md 读取当前工作区文件，每次工具调用只执行一个cat命令，不要组合命令或并行封装（不要只凭名字推测内容），将 one.md 末尾添加一行 Accepted.，最后用中文简短回答读到的两个关键词和修改结果。不要访问网络，不要读取工作区外文件，不要提交 Git。'});
 let session;for(let i=0;i<650;i++){session=(await h.call('/snapshot')).sessions.find(s=>s.id===id);if(session.approvals.length)throw Error('Real Agent requested approval; acceptance must not silently broaden permissions');if(session.error)throw Error(session.error);if(session.stopReason==='end_turn')break;await sleep(200);}
 assert.equal(session.stopReason,'end_turn');assert.ok(session.tools.some(tool=>tool.kind==='read'),`real ACP must provide explicit read events: ${JSON.stringify(session.tools.map(t=>({kind:t.kind,title:t.title,locations:t.locations})))}`);
 const vite=spawn(process.execPath,[resolve('node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','5174','--strictPort'],{cwd:resolve('apps/desktop'),stdio:'ignore'});const exited=once(vite,'exit');t.after(async()=>{vite.kill();await exited;});for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:5174')).ok)break;}catch{}await sleep(30);}
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1600,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(connection=>{localStorage.setItem('vibeone-theme','dark');window.__TAURI_INTERNALS__={invoke:async command=>{if(command==='host_connection')return connection;if(command==='notification_permission')return {status:'denied'};throw Error(command);}};},h.connection);
 await page.goto('http://127.0.0.1:5174');await page.locator('.desktop-session').first().click();const turn=page.locator('.desktop-turn').last();const disclosure=turn.locator('.desktop-activity-toggle');const answer=turn.locator('.desktop-agent-reply');await answer.waitFor();
 const output=join(tmpdir(),'vibeone-real-chat-108');await mkdir(output,{recursive:true});
 for(const theme of ['dark','light']){
  await page.getByRole('combobox',{name:'主题',exact:true}).selectOption(theme);
  if(await disclosure.getAttribute('aria-expanded')==='true')await disclosure.click();
  assert.equal(await turn.locator('.desktop-activity-history').count(),0);assert.ok(await answer.isVisible());await page.screenshot({path:join(output,`${theme}-collapsed.png`),animations:'disabled'});
  await disclosure.click();assert.equal(await disclosure.getAttribute('aria-expanded'),'true');assert.ok(await answer.isVisible());const reads=turn.locator('.desktop-tool-group').filter({has:page.locator('.event-files')}).first();await reads.waitFor();
  assert.equal(await reads.getAttribute('open'),null);await page.screenshot({path:join(output,`${theme}-process-open.png`),animations:'disabled'});
  await reads.locator(':scope > summary').click();const file=reads.locator('button.event-file').filter({hasText:'one.md'}).first();await file.waitFor();assert.equal(await file.isEnabled(),true);await file.click();
  const explorer=page.getByRole('region',{name:'文件浏览器',exact:true});await explorer.locator('.explorer-code').filter({hasText:'Alpha acceptance text.'}).waitFor();
  assert.ok(await file.getAttribute('title').then(value=>value.endsWith('one.md')));await page.screenshot({path:join(output,`${theme}-files-open.png`),animations:'disabled'});
  await page.getByRole('button',{name:'收起右侧面板',exact:true}).click();await reads.locator(':scope > summary').click();await disclosure.click();assert.ok(await answer.isVisible());
  const summary=turn.locator('.change-summary');await summary.waitFor();const metrics=await summary.evaluate(n=>({width:n.getBoundingClientRect().width,parent:n.parentElement.getBoundingClientRect().width,top:getComputedStyle(n).borderTopWidth,bottom:getComputedStyle(n).borderBottomWidth}));assert.ok(Math.abs(metrics.width-metrics.parent)<2);assert.equal(metrics.top,'1px');assert.equal(metrics.bottom,'1px');
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({provider:'codex',stopReason:session.stopReason,readEvents:session.tools.filter(t=>t.kind==='read').length,captures:output}));
});
