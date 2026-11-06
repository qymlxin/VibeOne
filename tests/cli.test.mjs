import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {host} from './helpers/host.mjs';
const exec=promisify(execFile),binary=resolve('target/debug/vibeone-host');
const cli=(directory,args,extra={})=>exec(binary,[...args,'--data-dir',directory],{timeout:30000,maxBuffer:2*1024*1024,...extra});

test('CLI lists summaries, probes a selected Profile and creates sessions with Host-fixed revisions',{timeout:25000},async t=>{
 const {directory,call}=await host(t);
 const workspace=join(directory,'工作 目录');await mkdir(workspace);
 const profile=await call('/profiles',{name:'CLI 配置',provider:'demo',args:[join(directory,'demo-agent.mjs'),'PRIVATE_ARGUMENT_NOT_FOR_CLI']});
 const apiCatalog=await call('/profiles');assert.doesNotMatch(JSON.stringify(apiCatalog),/PRIVATE_ARGUMENT|demo-agent|args|command/);
 const raw=await cli(directory,['profiles','list']);const listed=JSON.parse(raw.stdout);
 assert.equal(listed.profiles[0].id,profile.id);assert.equal(listed.profiles[0].revision,1);
 assert.doesNotMatch(raw.stdout,/PRIVATE_ARGUMENT|demo-agent|token|args|command/);
 const probe=JSON.parse((await cli(directory,['profiles','probe','--profile',profile.id])).stdout);
 assert.equal(probe.state,'ready');assert.equal(probe.profileRevision,1);
 assert.equal((await call('/snapshot')).sessions.length,0,'probing never creates a session');
 const first=JSON.parse((await cli(directory,['session','create','--profile',profile.id,'--workspace',workspace])).stdout);
 await call('/profiles',{id:profile.id,revision:1,name:'CLI 配置新修订',provider:'demo'});
 const second=JSON.parse((await cli(directory,['session','create','--profile',profile.id])).stdout);
 const snapshot=await call('/snapshot'),a=snapshot.sessions.find(s=>s.id===first.id),b=snapshot.sessions.find(s=>s.id===second.id);
 assert.equal(a.profile.revision,1);assert.equal(b.profile.revision,2);assert.notEqual(a.workspace,b.workspace);
 assert.equal(a.workspace,await import('node:fs/promises').then(fs=>fs.realpath(workspace)));
 assert.equal(a.messages.length,0);assert.equal(b.messages.length,0);assert.equal(a.runs.length,0);assert.equal(b.runs.length,0);
 for(const args of [['session','create'],['profiles','list','--profile',profile.id],['profiles','probe','--profile','missing'],['profiles','list','--data-dir',directory]]){
  await assert.rejects(cli(directory,args),error=>{assert.equal(error.code,1);assert.doesNotMatch(error.stderr,/PRIVATE_ARGUMENT/);return true;});
 }
 const defaultDir=await exec(binary,['profiles','list'],{env:{...process.env,VIBEONE_DATA_DIR:directory}});
 assert.equal(JSON.parse(defaultDir.stdout).profiles[0].revision,2);
});

test('CLI rejects non-loopback descriptors, ignores proxies and never follows redirects or prints tokens',{timeout:18000},async t=>{
 const {directory,call}=await host(t);
 await call('/profiles',{name:'direct',provider:'demo'});
 let requests=0,large=false;
 const server=createServer((request,response)=>{requests++;if(large){response.writeHead(200);response.end(Buffer.alloc(1024*1024+1,'x'));return;}response.writeHead(302,{Location:'http://192.0.2.1/should-not-follow'});response.end(JSON.stringify({error:'PRIVATE_DESCRIPTOR_TOKEN'}));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
 const proxy=`http://127.0.0.1:${server.address().port}`;
 const result=await cli(directory,['profiles','list'],{env:{...process.env,HTTP_PROXY:proxy,HTTPS_PROXY:proxy,ALL_PROXY:proxy,NO_PROXY:''}});
 assert.equal(JSON.parse(result.stdout).profiles[0].name,'direct');assert.equal(requests,0);
 const isolated=join(directory,'descriptor fixture');await mkdir(isolated);
 await writeFile(join(isolated,'host.json'),JSON.stringify({url:'http://192.0.2.1:80',token:'PRIVATE_DESCRIPTOR_TOKEN'}));
 await assert.rejects(cli(isolated,['profiles','list']),error=>{assert.match(error.stderr,/回环/);assert.doesNotMatch(error.stderr,/PRIVATE_DESCRIPTOR_TOKEN/);return true;});
 assert.equal(requests,0);
 await writeFile(join(isolated,'host.json'),JSON.stringify({url:proxy,token:'PRIVATE_DESCRIPTOR_TOKEN'}));
 await assert.rejects(cli(isolated,['profiles','list']),error=>{assert.doesNotMatch(error.stderr,/PRIVATE_DESCRIPTOR_TOKEN|should-not-follow/);return true;});
 assert.equal(requests,1,'a redirect must not issue another authenticated request');
 large=true;
 await assert.rejects(cli(isolated,['profiles','list']),error=>{assert.match(error.stderr,/1 MiB/);assert.doesNotMatch(error.stderr,/PRIVATE_DESCRIPTOR_TOKEN/);return true;});
 assert.equal(requests,2);
});
