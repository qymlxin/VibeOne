import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,rm,cp,readFile,symlink} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {host} from './helpers/host.mjs';

function request(connection){return async(path,body,status=200,code)=>{
 const response=await fetch(connection.url+'/v1'+path,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${connection.token}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(2500)});
 const value=await response.json();assert.equal(response.status,status,JSON.stringify(value));
 if(code){assert.equal(value.code,code);assert.equal(value.requestId,response.headers.get('x-vibeone-request-id'));}
 return value;
};}
const manifest={manifestVersion:1,id:'test.resources',name:'Resources',version:'0.1.0',engines:{pluginApi:'>=0.1 <0.2'},contributions:[]};

test('plugin inspection and App queries preserve resource and validation error identities',{timeout:25000},async t=>{
 const {connection,directory,call}=await host(t),send=request(connection);
 const root=join(directory,'package');await mkdir(root);
 const inspect=()=>send('/plugins/inspect',{path:root});
 await send('/plugins/inspect',{path:root},404,'PLUGIN_RESOURCE_NOT_FOUND');
 await writeFile(join(root,'plugin.json'),'{invalid');
 await send('/plugins/inspect',{path:join(root,'plugin.json')},400,'PLUGIN_INVALID');
 await send('/plugins/inspect',{path:root},400,'PLUGIN_INVALID');
 await writeFile(join(root,'plugin.json'),' '.repeat(65537));
 await send('/plugins/inspect',{path:root},400,'PLUGIN_RESOURCE_TOO_LARGE');
 await writeFile(join(root,'plugin.json'),JSON.stringify({...manifest,engines:{pluginApi:'incompatible'}}));
 await send('/plugins/inspect',{path:root},409,'PLUGIN_INCOMPATIBLE');
 await mkdir(join(root,'worker'));
 await writeFile(join(root,'plugin.json'),JSON.stringify({...manifest,entrypoints:{worker:{path:'worker'}}}));
 await send('/plugins/inspect',{path:root},400,'PLUGIN_INVALID');
 await writeFile(join(root,'plugin.json'),JSON.stringify({...manifest,entrypoints:{app:{path:'../host.json'}}}));
 await send('/plugins/inspect',{path:root},403,'RESOURCE_FORBIDDEN');
 if(process.platform!=='win32'){
  await symlink(join(directory,'host.json'),join(root,'linked'));
  await writeFile(join(root,'plugin.json'),JSON.stringify({...manifest,entrypoints:{app:{path:'linked'}}}));
  await send('/plugins/inspect',{path:root},403,'RESOURCE_FORBIDDEN');
 }
 await writeFile(join(root,'app.mjs'),Buffer.from([0xff]));
 await writeFile(join(root,'plugin.json'),JSON.stringify({...manifest,entrypoints:{app:{path:'app.mjs'}}}));
 await send('/plugins/inspect',{path:root},400,'PLUGIN_INVALID');
 await writeFile(join(root,'app.mjs'),'x'.repeat(1024*1024+1));
 await send('/plugins/inspect',{path:root},400,'PLUGIN_RESOURCE_TOO_LARGE');
 const serialized=JSON.stringify(manifest);
 await writeFile(join(root,'plugin.json'),serialized+' '.repeat(65536-Buffer.byteLength(serialized)));
 assert.equal((await inspect()).id,manifest.id);
 const source=join(directory,'valid');await cp(resolve('examples/plugins/workspace-tools'),source,{recursive:true});
 const candidate=await call('/plugins/prepare',{path:source,trusted:true,workspaces:[]});
 await call('/plugins/commit',{ticket:candidate.ticket});
 const endpoint=`/plugins/${candidate.plugin.id}/app`,app=join(candidate.plugin.path,candidate.plugin.manifest.entrypoints.app.path);
 const original=await readFile(app);
 assert.equal((await send(endpoint)).source,original.toString());
 await writeFile(app,Buffer.from([0xff,0xfe]));await send(endpoint,undefined,400,'PLUGIN_INVALID');
 await writeFile(app,'x'.repeat(1024*1024+1));await send(endpoint,undefined,400,'PLUGIN_RESOURCE_TOO_LARGE');
 await rm(app);await mkdir(app);await send(endpoint,undefined,400,'PLUGIN_INVALID');
 await rm(app,{recursive:true});await writeFile(app,original);
 assert.equal((await send(endpoint)).source,original.toString());
 await send('/plugins/missing/app',undefined,404,'PLUGIN_NOT_FOUND');
 await call(`/plugins/${candidate.plugin.id}/disable`,{});await send(endpoint,undefined,409,'PLUGIN_DISABLED');
});

test('plugin manifest and App named pipes are rejected without waiting for a writer',{timeout:30000,skip:process.platform==='win32'},async t=>{
 const {connection,directory,call}=await host(t),send=request(connection);
 const root=join(directory,'pipe-package');await mkdir(root);execFileSync('mkfifo',[join(root,'plugin.json')]);
 await send('/plugins/inspect',{path:root},400,'PLUGIN_INVALID');
 const source=join(directory,'valid');await cp(resolve('examples/plugins/workspace-tools'),source,{recursive:true});
 const candidate=await call('/plugins/prepare',{path:source,trusted:true,workspaces:[]});
 await call('/plugins/commit',{ticket:candidate.ticket});
 const app=join(candidate.plugin.path,candidate.plugin.manifest.entrypoints.app.path);await rm(app);execFileSync('mkfifo',[app]);
 await send(`/plugins/${candidate.plugin.id}/app`,undefined,400,'PLUGIN_INVALID');
 assert.ok((await call('/snapshot')).plugins.some(item=>item.id===candidate.plugin.id));
});
