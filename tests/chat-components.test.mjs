import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

test('completed answer uses approved full-width change summary before answer actions',async t=>{
 const cache=resolve('node_modules/.cache');await mkdir(cache,{recursive:true});const directory=await mkdtemp(join(cache,'chat-component-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const outfile=join(directory,'chat.mjs');await build({entryPoints:['apps/desktop/src/ChatTimeline.jsx'],outfile,bundle:true,packages:'external',format:'esm',platform:'node'});
 const {AgentResponse}=await import(pathToFileURL(outfile));
 const html=renderToStaticMarkup(React.createElement(AgentResponse,{turn:{id:'run',process:[],answer:{id:'answer',text:'Finished'},live:false,run:{status:'completed',startedAt:0,finishedAt:1000}},name:'Codex',status:'idle',onReadHistory(){},onChanges(){},changeCount:1}));
 assert.match(html,/class="change-summary[^"]*"/,'use the approved bordered row, not the old button');
 assert.ok(html.indexOf('change-summary')<html.indexOf('message-actions'),'change summary belongs above footer actions');
});
