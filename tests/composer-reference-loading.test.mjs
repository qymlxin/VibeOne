import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from '@playwright/test';

test('reference candidates stay visible while loading and stale files cannot be attached',{timeout:15000},async t=>{
 const dir=await mkdtemp(resolve('node_modules/.cache/composer-loading-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const entry=join(dir,'entry.jsx');
 await writeFile(entry,`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{ComposerInput}from'${resolve('apps/desktop/src/ComposerInput.jsx')}';
 window.requests=[];window.attachments=[];window.submissions=0;
 const workbench={features:[],read:(path)=>new Promise((resolve,reject)=>{window.requests.push({path,resolve,reject})})};
 const session={id:'s',status:'idle',agentState:{}};
 function App(){const[value,onChange]=useState(''),[files,onFiles]=useState([]);window.attachments=files;return <ComposerInput session={session} workbench={workbench} value={value} onChange={onChange} files={files} onFiles={onFiles} onSubmit={()=>window.submissions++} online={true}/>};
 createRoot(document.getElementById('root')).render(<App/>);`);
 await build({entryPoints:[entry],outfile:join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',logLevel:'silent'});
 const server=createServer(async(req,res)=>{try{if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<meta charset="utf-8"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>');return;}res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(join(dir,req.url.slice(1))));}catch{res.statusCode=404;res.end()}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const browser=await chromium.launch();t.after(()=>browser.close());const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
 const input=page.getByRole('textbox',{name:'发送任务'}),list=page.getByRole('listbox');
 await input.fill('@sa');await page.waitForFunction(()=>window.requests.length===1);
 await page.evaluate(()=>window.requests[0].resolve({entries:[{kind:'file',name:'sample.md',path:'docs/sample.md'}]}));
 await list.waitFor();await page.waitForFunction(()=>document.querySelector('[role=listbox]')?.getAttribute('aria-busy')==='false');
 const heading=page.locator('.composer-picker-heading');const settledHeading=await heading.textContent();
 await input.fill('@sam');assert.equal(await heading.textContent(),settledHeading);assert.equal(await page.getByRole('option').count(),1);assert.equal(await list.getAttribute('aria-busy'),'true');assert.equal(await page.getByRole('option').isDisabled(),true);
 await input.press('Enter');assert.equal(await page.evaluate(()=>window.attachments.length),0);assert.equal(await page.evaluate(()=>window.submissions),0);
 await page.waitForFunction(()=>window.requests.length===2);
 await page.evaluate(()=>window.requests[1].resolve({entries:[{kind:'file',name:'sample.md',path:'docs/sample.md'}]}));await page.waitForFunction(()=>document.querySelector('[role=listbox]')?.getAttribute('aria-busy')==='false');
 assert.equal(await heading.textContent(),settledHeading);
 await input.press('Enter');await page.waitForFunction(()=>window.attachments[0]==='docs/sample.md');
 // A late earlier query must not replace the newest settled candidates.
 await input.fill('@old');await page.waitForFunction(()=>window.requests.length===3);await input.fill('@new');await page.waitForFunction(()=>window.requests.length===4);
 await page.evaluate(()=>window.requests[3].resolve({entries:[{kind:'file',name:'new.md',path:'new.md'}]}));await page.getByRole('option',{name:'new.md new.md'}).waitFor();
 await page.evaluate(()=>window.requests[2].resolve({entries:[{kind:'file',name:'old.md',path:'old.md'}]}));assert.equal(await page.getByRole('option',{name:'old.md old.md'}).count(),0);
});
