import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,readdir,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import https from 'node:https';
import net from 'node:net';
import {host} from './helpers/host.mjs';

async function setup(t){
 const web=await mkdtemp(join(tmpdir(),'vibeone-remote-web-'));await writeFile(join(web,'index.html'),'isolated mobile page');t.after(()=>rm(web,{recursive:true,force:true}));
 const harness=await host(t,{VIBEONE_WEB_DIR:web});
 const local=async(path,body,status=200,code)=>{
  const response=await fetch(harness.connection.url+'/v1'+path,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${harness.connection.token}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(4000)});
  const value=await response.json();assert.equal(response.status,status,JSON.stringify(value));
  if(code){assert.equal(value.code,code);assert.equal(value.requestId,response.headers.get('x-vibeone-request-id'));assert.equal(value.status,status);}
  return value;
 };
 return {...harness,local};
}
async function tlsClient(directory,url){
 const ca=await readFile(join(directory,'VibeOne-Root-CA.crt'));
 return (path,body)=>new Promise((resolve,reject)=>{
  const request=https.request(url+'/v1'+path,{ca,agent:false,method:body===undefined?'GET':'POST',headers:{Origin:url,'Content-Type':'application/json'},signal:AbortSignal.timeout(4000)},response=>{
   let text='';response.on('data',chunk=>text+=chunk);response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body:JSON.parse(text)}));response.on('error',reject);
  });request.on('error',reject);request.end(body===undefined?undefined:JSON.stringify(body));
 });
}

test('repeat decisions preserve the original credential and revocation stops later delivery',{timeout:22000},async t=>{
 const {directory,local}=await setup(t);
 const workspace=await local('/workspaces',{path:directory});const remote=await local('/remote',{enabled:true,ip:'127.0.0.1',port:0});const request=await tlsClient(directory,remote.url);
 const code=await local('/pairing/code',{}),secret='PRIVATE_CLAIM_SECRET_'.repeat(3);
 const invalidName=await request('/pairing/claim',{code:code.code,name:17,secret});assert.equal(invalidName.status,400);assert.equal(invalidName.body.code,'INVALID_INPUT');
 const claim=await request('/pairing/claim',{code:code.code,name:'fixture',secret});assert.equal(claim.status,200);
 const decision={role:'viewer',workspaces:[workspace.id]};
 await local(`/devices/${claim.body.id}/approve`,{...decision,deny:'true'},400,'INVALID_INPUT');
 await local(`/devices/${claim.body.id}/approve`,decision);
 const first=await request('/pairing/poll',{id:claim.body.id,secret});assert.equal(first.body.status,'approved');
 // A lost approval reply must not rotate the credential or force a second decision.
 await local(`/devices/${claim.body.id}/approve`,{...decision,workspaces:[workspace.id,workspace.id]});
 const again=await request('/pairing/poll',{id:claim.body.id,secret});assert.deepEqual(again.headers['set-cookie'],first.headers['set-cookie']);
 await local(`/devices/${claim.body.id}/approve`,{...decision,role:'operator'},409,'PAIRING_CONFLICT');
 await local(`/devices/${claim.body.id}/approve`,{deny:true},409,'PAIRING_CONFLICT');
 await local(`/devices/${claim.body.id}/revoke`,{});await local(`/devices/${claim.body.id}/revoke`,{});
 const revoked=await request('/pairing/poll',{id:claim.body.id,secret});assert.equal(revoked.body.status,'denied');assert.equal(revoked.headers['set-cookie'],undefined);
 const wrong=await request('/pairing/poll',{id:claim.body.id,secret:'PRIVATE_WRONG_SECRET'});assert.equal(wrong.status,403);assert.equal(wrong.body.code,'PAIRING_INVALID');assert.equal(JSON.stringify(wrong.body).includes('PRIVATE'),false);
 const nextCode=await local('/pairing/code',{}),next=await request('/pairing/claim',{code:nextCode.code,name:'denied',secret});
 await local(`/devices/${next.body.id}/approve`,{deny:true});await local(`/devices/${next.body.id}/approve`,{deny:true});
 await local(`/devices/${next.body.id}/approve`,decision,409,'PAIRING_CONFLICT');
 assert.equal((await request('/pairing/poll',{id:next.body.id,secret})).body.status,'denied');
 await local('/devices/missing/approve',decision,409,'PAIRING_EXPIRED');await local('/devices/missing/revoke',{},404,'DEVICE_NOT_FOUND');
 const devices=await local('/devices');assert.equal(JSON.stringify(devices).includes(secret),false);assert.equal(JSON.stringify(devices).includes('tokenHash'),false);
});

test('remote controls classify failures and occupied ports cannot replace certificate identity',{timeout:22000},async t=>{
 const {directory,local}=await setup(t);
 await local('/pairing/code',{},409,'REMOTE_DISABLED');
 await local('/remote',{enabled:true,ip:'8.8.8.8'},403,'REMOTE_ADDRESS_FORBIDDEN');
 await local('/remote',{enabled:true,ip:'PRIVATE_BAD_ADDRESS'},400,'INVALID_INPUT');
 for(const port of [-1,65536,'not-a-port'])await local('/remote',{enabled:true,ip:'127.0.0.1',port},400,'INVALID_INPUT');
 const remote=await local('/remote',{enabled:true,ip:'127.0.0.1',port:0});
 await local('/remote',{enabled:true,ip:'127.0.0.1',port:0},409,'REMOTE_ALREADY_RUNNING');
 const request=await tlsClient(directory,remote.url);
 for(let attempt=0;attempt<12;attempt++){const denied=await request('/pairing/claim',{code:'not-a-code',secret:'fixture-secret-'.repeat(3)});assert.equal(denied.status,403);assert.equal(denied.body.code,'PAIRING_INVALID');}
 const rate=await request('/pairing/claim',{code:'not-a-code',secret:'fixture-secret-'.repeat(3)});assert.equal(rate.status,429);assert.equal(rate.body.code,'PAIRING_RATE_LIMITED');
 await local('/remote',{enabled:false});
 const tlsPath=join(directory,'remote-tls.json'),saved=JSON.parse(await readFile(tlsPath,'utf8'));saved.ip='127.0.0.2';await writeFile(tlsPath,JSON.stringify(saved));
 const before=await readFile(tlsPath),caBefore=await readFile(join(directory,'VibeOne-Root-CA.crt'));
 const occupied=net.createServer();await new Promise((resolve,reject)=>{occupied.once('error',reject);occupied.listen(0,'127.0.0.1',resolve);});t.after(()=>new Promise(resolve=>occupied.close(resolve)));
 await local('/remote',{enabled:true,ip:'127.0.0.1',port:occupied.address().port},409,'REMOTE_ADDRESS_IN_USE');
 assert.deepEqual(await readFile(tlsPath),before);assert.deepEqual(await readFile(join(directory,'VibeOne-Root-CA.crt')),caBefore);
 await writeFile(tlsPath,'{"key":"PRIVATE_TLS_VALUE"}');
 const bad=await local('/remote',{enabled:true,ip:'127.0.0.1',port:0},409,'REMOTE_TLS_INVALID');assert.equal(JSON.stringify(bad).includes('PRIVATE'),false);
 assert.equal((await local('/devices')).url,null);assert.equal((await readdir(directory)).some(name=>name.startsWith('.remote-')),false);
 if(process.platform!=='win32')assert.equal((await stat(tlsPath)).mode&0o077,0);
});
