import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,rm,mkdtemp,symlink} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {host} from './helpers/host.mjs';
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{stdio:'ignore'});
const commit=root=>git(root,'-c','user.name=Test','-c','user.email=test@example.invalid','-c','commit.gpgsign=false','commit','-m','fixture');
function failure(connection){return async(path,status,code,body)=>{
 const response=await fetch(connection.url+'/v1'+path,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${connection.token}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(3000)});
 const value=await response.json();assert.equal(response.status,status,JSON.stringify(value));assert.equal(value.code,code);assert.equal(value.status,status);assert.equal(response.headers.get('x-vibeone-request-id'),value.requestId);return value;
};}

test('resource errors distinguish missing, forbidden, invalid types and Git failures without losing valid history',{timeout:20000},async t=>{
 const {connection,call,directory}=await host(t);const fail=failure(connection);
 const root=join(directory,'workspace');await mkdir(root);await writeFile(join(root,'note.txt'),'snapshot text');await writeFile(join(root,'binary'),Buffer.from([0,1]));
 const {id}=await call('/sessions',{provider:'demo',workspace:root});const base=`/sessions/${id}`;
 for(const suffix of ['file?path=note.txt','tree','changes','diff?path=note.txt','artifacts','history'])await fail('/sessions/missing/'+suffix,404,'SESSION_NOT_FOUND');
 await fail(base+'/file?path=missing',404,'RESOURCE_NOT_FOUND');
 await fail(base+'/tree?path=note.txt',400,'INVALID_INPUT');
 await fail(base+'/file?path=.',400,'INVALID_INPUT');
 await writeFile(join(root,'utf8.txt'),'中'.repeat(100000));
 const text=await call(base+'/file?path=utf8.txt');assert.equal(text.binary,false);assert.equal(text.truncated,true);assert.equal(text.text.includes('�'),false);

 await fail(base+'/file?path=../host.json',403,'RESOURCE_FORBIDDEN');
 if(process.platform!=='win32'){
  await symlink(directory,join(root,'outside'));await fail(base+'/file?path=outside/host.json',403,'RESOURCE_FORBIDDEN');
 }
 assert.equal((await call(base+'/changes')).isGit,false);
 await fail(base+'/artifacts',400,'ARTIFACT_UNSUPPORTED',{path:'binary'});
 await fail(base+'/history?limit=0',400,'INVALID_INPUT');
 assert.deepEqual(await call(base+'/artifacts'),[]);
 const saved=await call(base+'/artifacts',{path:'note.txt'});await writeFile(join(root,'note.txt'),'changed');
 assert.equal((await call(base+'/artifacts'))[0].content.text,'snapshot text');assert.equal(saved.source,'workspace_snapshot');
 await rm(root,{recursive:true});await fail(base+'/tree',404,'WORKSPACE_NOT_FOUND');
});

test('Git status failures are not a clean workspace and deleted parent directories still have diffs',{timeout:20000},async t=>{
 const {connection,call,directory}=await host(t);const fail=failure(connection);
 const root=join(directory,'repo');await mkdir(join(root,'nested','removed'),{recursive:true});git(root,'init');
 await writeFile(join(root,'nested','removed','tracked.txt'),'deleted text');git(root,'add','nested');commit(root);
 const {id}=await call('/sessions',{provider:'demo',workspace:root});const base=`/sessions/${id}`;
 await rm(join(root,'nested'),{recursive:true});
 const diff=await call(base+'/diff?path=nested/removed/tracked.txt');assert.ok(diff.text.includes('-deleted text'));
 await writeFile(join(root,'.git','index'),'corrupted index');
 await fail(base+'/changes',502,'GIT_QUERY_FAILED');
});

test('Git environment cannot redirect a workspace diff to another repository',{timeout:20000},async t=>{
 const outside=await mkdtemp(join(tmpdir(),'vibeone-git-environment-'));t.after(()=>rm(outside,{recursive:true,force:true}));
 git(outside,'init');await writeFile(join(outside,'tracked.txt'),'outside before');git(outside,'add','tracked.txt');commit(outside);await writeFile(join(outside,'tracked.txt'),'OUTSIDE_PRIVATE_MARKER');
 const previous={GIT_DIR:process.env.GIT_DIR,GIT_WORK_TREE:process.env.GIT_WORK_TREE};let harness;
 try{process.env.GIT_DIR=join(outside,'.git');process.env.GIT_WORK_TREE=outside;harness=await host(t);}finally{for(const [key,value]of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
 const {call,directory}=harness;const root=join(directory,'repo');await mkdir(root);git(root,'init');await writeFile(join(root,'tracked.txt'),'local before');git(root,'add','tracked.txt');commit(root);await writeFile(join(root,'tracked.txt'),'LOCAL_WORKSPACE_CHANGE');
 const {id}=await call('/sessions',{provider:'demo',workspace:root});const diff=await call(`/sessions/${id}/diff?path=tracked.txt`);
 assert.ok(diff.text.includes('LOCAL_WORKSPACE_CHANGE'));assert.equal(diff.text.includes('OUTSIDE_PRIVATE_MARKER'),false);
 const secondRoot=join(directory,'repo-two');await mkdir(secondRoot);git(secondRoot,'init');
 const second=await call('/sessions',{provider:'demo',workspace:secondRoot});
 await call(`/sessions/${id}/messages`,{text:'/wait'});await harness.wait(id,s=>s.status==='running');
 await call(`/sessions/${second.id}/messages`,{text:'/wait'});await harness.wait(second.id,s=>s.status==='running');

});

test('workspace previews reject named pipes without waiting for a writer',{timeout:16000,skip:process.platform==='win32'},async t=>{
 const {connection,call,directory}=await host(t);const root=join(directory,'project');await mkdir(root);execFileSync('mkfifo',[join(root,'pipe')]);
 const {id}=await call('/sessions',{provider:'demo',workspace:root});await failure(connection)(`/sessions/${id}/file?path=pipe`,400,'INVALID_INPUT');
});
