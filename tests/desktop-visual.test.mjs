import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {writeFile,mkdir} from 'node:fs/promises';
import {setTimeout as sleep} from 'node:timers/promises';
import {chromium} from '@playwright/test';
import {host} from './helpers/host.mjs';

test('approved desktop geometry survives themes, panels and settings with live Host', {timeout:60000}, async t=>{
 const h=await host(t);await writeFile(join(h.directory,'preview.txt'),'VibeOne workspace preview\n');
 const git=(...args)=>execFileSync('git',['-C',h.directory,...args],{stdio:'ignore'});git('init');await writeFile(join(h.directory,'tracked.txt'),'Before visual acceptance.\n');git('add','tracked.txt');git('-c','core.hooksPath=/dev/null','-c','user.name=Test','-c','user.email=test@example.com','commit','-m','fixture');await writeFile(join(h.directory,'tracked.txt'),'After visual acceptance.\n');
 const {id}=await h.call('/sessions',{provider:'demo',workspace:h.directory});
 await h.call(`/sessions/${id}/messages`,{text:'视觉验收：保留清晰的对话分段。'});
 await h.wait(id,s=>s.status==='idle'&&s.messages.some(m=>m.role==='assistant'));
 const vite=spawn(process.execPath,[resolve('node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','5174','--strictPort'],{cwd:resolve('apps/desktop'),stdio:'ignore'});
 const viteExited=once(vite,'exit');t.after(async()=>{vite.kill();await viteExited;});
 const url='http://127.0.0.1:5174';for(let i=0;i<100;i++){try{if((await fetch(url)).ok)break;}catch{}await sleep(30);}
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1600,height:1000}});
 await page.addInitScript(connection=>{localStorage.setItem('vibeone-theme','dark');window.__TAURI_INTERNALS__={invoke:async command=>{if(command==='host_connection')return connection;if(command==='notification_permission')return {status:'denied',source:'test'};throw Error(command);}};},h.connection);
 await page.goto(url);await page.locator('.desktop-session').first().click();await page.getByRole('textbox',{name:'发送任务'}).waitFor();
 const output=join(tmpdir(),'vibeone-parity-107');await mkdir(output,{recursive:true});
 const measure=selector=>page.locator(selector).evaluate(node=>{const r=node.getBoundingClientRect();const s=getComputedStyle(node);return {x:r.x,y:r.y,width:r.width,height:r.height,fontSize:s.fontSize,background:s.backgroundColor};});
 const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<=1,`${actual} differs from approved ${expected}`);
 for(const theme of ['dark','light']){
  await page.getByRole('combobox',{name:'主题',exact:true}).selectOption(theme);
  near((await measure('.desktop-connection')).height,40);near((await measure('.desktop-sidebar')).width,224);
  near((await measure('.desktop-conversation-heading')).height,72);near((await measure('.desktop-composer')).width,730);
  near((await measure('.desktop-composer textarea')).height,52);
  assert.equal(await page.locator('.desktop-composer textarea').evaluate(node=>getComputedStyle(node).fontSize),'13px');
  await page.screenshot({path:join(output,`${theme}-chat.png`),animations:'disabled'});
  for(const name of ['变更','文件','终端','网址浏览']){
   await page.getByRole('navigation',{name:'会话视图'}).getByRole('button',{name,exact:true}).click();
   if(name==='文件')await page.locator('.explorer-tree').getByRole('button',{name:'preview.txt',exact:true}).click();if(name==='变更')await page.locator('.explorer-tree').getByRole('button',{name:/tracked.txt/}).click();
   near((await measure('.desktop-right-panel-header')).height,47);near((await measure('.desktop-right-panel')).y,40);
   const composer=await measure('.desktop-composer'),chat=await measure('.desktop-chat-column');assert.ok(composer.width<=730&&composer.x>=chat.x&&composer.x+composer.width<=chat.x+chat.width+1);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.screenshot({path:join(output,`${theme}-${name}.png`),animations:'disabled'});
  }
  await page.getByRole('button',{name:'收起右侧面板',exact:true}).click();
  await page.getByRole('button',{name:'连接与设置',exact:true}).click();
  await page.getByRole('heading',{name:'常规',exact:true,level:1}).waitFor();
  near((await measure('.desktop-settings-navigation')).width,224);near((await measure('.desktop-settings-content')).width,780);
  await page.getByRole('heading',{name:'会话与执行',exact:true}).waitFor();
  await page.screenshot({path:join(output,`${theme}-settings.png`),animations:'disabled'});
  for(const [name,key]of [['外观','appearance'],['通知','notifications'],['Agent','agents'],['工作区','workspaces'],['插件','plugins'],['远程连接','remote'],['数据与诊断','data']]){await page.getByRole('navigation',{name:'设置分类'}).getByRole('button',{name,exact:true}).click();await page.getByRole('heading',{name,exact:true,level:1}).waitFor();await page.screenshot({path:join(output,`${theme}-${key}.png`),animations:'disabled'});}
  await page.getByRole('button',{name:'返回工作台',exact:true}).click();
 }
});
