// Verify only the built resources in a temporary copy, never the user's running Host.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {cp,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as sleep} from 'node:timers/promises';
import {createHash} from 'node:crypto';
import https from 'node:https';
import {createInterface} from 'node:readline';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
const app=resolve(process.argv[2]??'apps/desktop/src-tauri/target/debug/bundle/macos/VibeOne.app');
const directory=await mkdtemp(join(tmpdir(),'vibeone-bundle-smoke-'));
let child,exited,connection;
async function initializeBridge(path,cwd){
 const env={...process.env,NODE_PATH:'',PATH:dirname(process.execPath)};
 const bridge=spawn(process.execPath,[path],{cwd,env,detached:process.platform!=='win32',stdio:['pipe','pipe','pipe']});
 const end=once(bridge,'exit'),lines=createInterface({input:bridge.stdout});
 let stderr='';bridge.stderr.on('data',chunk=>stderr=(stderr+chunk.toString()).slice(-1200));
 let timer;
 try{
  const result=await new Promise((resolve,reject)=>{
   timer=setTimeout(()=>reject(Error('Packaged ACP initialize timed out')),20000);
   bridge.once('error',reject);bridge.once('exit',()=>reject(Error(`Packaged ACP exited before initialize: ${stderr}`)));
   lines.on('line',line=>{try{const message=JSON.parse(line);if(message.id===1){if(message.error)reject(Error(message.error.message));else resolve(message.result);}}catch(error){reject(error);}});
   bridge.stdin.on('error',reject);
   bridge.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:2,info:{name:'vibeone-bundle-smoke',version:'0.1.0'},capabilities:{}}})+'\n');
  });
  assert.equal(result.protocolVersion,2);assert.ok(result.capabilities?.session);return result.info.name;
 }finally{
  clearTimeout(timer);lines.close();
  if(bridge.exitCode===null&&bridge.signalCode===null){try{if(process.platform==='win32')bridge.kill();else process.kill(-bridge.pid,'SIGTERM');}catch{}}
  const force=setTimeout(()=>{try{if(process.platform==='win32')bridge.kill('SIGKILL');else process.kill(-bridge.pid,'SIGKILL');}catch{}},2000);
  await end;clearTimeout(force);
 }
}
try{
 const resources=join(directory,'resources');
 await cp(join(app,'Contents/Resources'),resources,{recursive:true});
 const data=join(directory,'data'),workspace=join(directory,'workspace');
 const {mkdir}=await import('node:fs/promises');await mkdir(workspace);
 await writeFile(join(workspace,'bundle-only.txt'),'isolated packaged resources');
 const binary=join(resources,'bin/vibeone-host');
 child=spawn(binary,['serve','--data-dir',data],{cwd:directory,stdio:'ignore',env:{...process.env,VIBEONE_RUNTIME_DIR:join(resources,'runtime'),VIBEONE_WEB_DIR:join(resources,'web'),VIBEONE_EXAMPLE_PLUGIN:join(resources,'examples/workspace-tools'),VIBEONE_BRIDGES_DIR:join(resources,'bridges')}});
 exited=once(child,'exit');
 for(let index=0;index<200;index++){
  try{const value=JSON.parse(await readFile(join(data,'host.json'),'utf8'));if(value.pid===child.pid){connection=value;break;}}catch{}
  if(child.exitCode!==null)throw Error('Packaged Host exited before readiness');
  await sleep(30);
 }
 assert.ok(connection,'packaged Host must start');
 const call=async(path,body)=>{
  const response=await fetch(`${connection.url}/v1${path}`,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${connection.token}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const value=await response.json();assert.ok(response.ok,value.error);return value;
 };
 const wait=async(id,predicate)=>{for(let index=0;index<300;index++){const session=(await call('/snapshot')).sessions.find(session=>session.id===id);if(predicate(session))return session;await sleep(30);}throw Error('Packaged session did not complete');};
 const snapshot=await call('/snapshot');
 assert.ok(snapshot.features.includes('conversationHistory'));
 assert.ok(snapshot.examplePluginPath.startsWith(resources));
 assert.ok(snapshot.providers.find(provider=>provider.id==='codex')?.available);
 assert.ok(snapshot.providers.find(provider=>provider.id==='claude')?.available);
 const bridgeRoot=join(resources,'bridges'),bridgeManifest=JSON.parse(await readFile(join(bridgeRoot,'bridge-manifest.json'),'utf8'));
 const bridgeResults={};
 for(const bridge of bridgeManifest.bridges)bridgeResults[bridge.binary]=await initializeBridge(join(bridgeRoot,bridge.binary),directory);
 const codexVersion=await exec(process.execPath,[join(bridgeRoot,'node_modules/@openai/codex/bin/codex.js'),'--version'],{cwd:directory,timeout:15000});
 assert.match(codexVersion.stdout,/codex/);
 const claudeNative=bridgeManifest.packages.find(pkg=>pkg.name===`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`);
 assert.ok(claudeNative,'current-platform Claude SDK binary must be packaged');
 const claudeVersion=await exec(join(bridgeRoot,claudeNative.path,'claude'),['--version'],{cwd:directory,timeout:15000});assert.ok(claudeVersion.stdout.trim());
 const remote=await call('/remote',{enabled:true,ip:'127.0.0.1',port:0});
 const ca=await readFile(join(data,'VibeOne-Root-CA.crt'));
 const webGet=path=>new Promise((resolve,reject)=>{https.get(`${remote.url}${path}`,{ca},response=>{let body='';response.on('data',chunk=>body+=chunk);response.on('end',()=>resolve({status:response.statusCode,body}));}).on('error',reject);});
 const web=await webGet('/');assert.equal(web.status,200);assert.match(web.body,/assets\/index-/);
 const index=(await readFile(join(resources,'web/index.html'),'utf8')).match(/src="([^"]+\.js)"/)[1];
 assert.equal((await webGet(index)).status,200,'packaged web asset must be served over the trusted HTTPS entry');
 const workspaceInfo=await call('/workspaces',{path:workspace});
 const path=snapshot.examplePluginPath,manifest=await call('/plugins/inspect',{path});
 const candidate=await call('/plugins/prepare',{path,trusted:true,workspaces:[workspaceInfo.id],expectedManifest:manifest});
 assert.ok(candidate.app.source.includes('defineApp'));
 await call('/plugins/commit',{ticket:candidate.ticket});
 const scan=await call(`/plugins/${candidate.plugin.id}/invoke`,{handler:'workspace.scan',workspaceId:workspaceInfo.id,input:{path:'.'}});
 assert.ok(scan.entries.some(item=>item.name==='bundle-only.txt'));
 const provider=manifest.contributions.find(item=>item.kind==='agent.provider');
 assert.ok(provider,'example package must contribute a real Provider');
 const session=await call('/sessions',{provider:`${candidate.plugin.id}:${provider.id}`,workspace});
 await call(`/sessions/${session.id}/messages`,{text:'package provider verification'});
 await wait(session.id,session=>session.runs.some(run=>run.status==='completed'));
 const history=await call(`/sessions/${session.id}/history`);
 assert.ok(history.records.some(record=>record.item.role==='assistant'));
 await call('/host/stop',{});await exited;
 console.log(JSON.stringify({packagedResources:true,isolatedDirectory:true,web:true,workerContext:true,pluginProvider:true,persistentHistory:true,bridges:bridgeResults,nativeClis:true,hostSha256:createHash('sha256').update(await readFile(binary)).digest('hex')},null,2));
}finally{
 if(child&&child.exitCode===null&&child.signalCode===null){
  if(connection)await fetch(`${connection.url}/v1/host/stop`,{method:'POST',headers:{Authorization:`Bearer ${connection.token}`}}).catch(()=>{});
  const timer=setTimeout(()=>child.kill('SIGKILL'),8500);await exited;clearTimeout(timer);
 }
 await rm(directory,{recursive:true,force:true});
}
