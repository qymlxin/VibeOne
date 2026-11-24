import test from 'node:test';
import assert from 'node:assert/strict';
import {composerToken,replaceToken,commandOptions,commandPanel,referenceOptions} from '../apps/desktop/src/composer.ts';
test('composer tokens respect caret, whitespace and preserve trailing text',()=>{
  assert.equal(composerToken('https://example.com',19),null);
  assert.equal(composerToken('mail@host',9),null);
  const text='查看 @src/ma 后面的文本',token=composerToken(text,10);
  assert.equal(token.kind,'@');
  assert.equal(replaceToken(text,token,''),'查看  后面的文本');
  assert.equal(composerToken('/hel',4).query,'hel');
  assert.equal(composerToken('@"my folder/ma',14).query,'my folder/ma');
});
test('commands use current ACP advertisements and never shadow Agent commands',()=>{
  const options=commandOptions([{name:'files',description:'上游文件命令'},{name:'compact',description:'压缩上下文'}],'');
  assert.equal(options.filter(option=>option.name==='files').length,1);
  assert.equal(options.find(option=>option.name==='files').source,'Agent 指令');
  assert.equal(commandOptions(null,'终端').length,0);
  assert.equal(commandPanel('/terminal',[]),'terminal');
  assert.equal(commandOptions(null,'思考')[0].control,'reasoning');
  assert.equal(commandOptions([], 'does-not-exist').length,0);
});

test('Chinese prose and punctuation open suggestions without matching emails or URLs',()=>{
  for(const text of ['看看@Cargo','请查看：@Cargo','查看（@Cargo','请用/terminal']){
    const token=composerToken(text,text.length);
    assert.ok(token,text);
    assert.equal(replaceToken(text,token,''),text.slice(0,token.start));
  }
  const text='查看@"folder name/child.txt" 后文';
  const token=composerToken(text,12);
  assert.equal(token.kind,'@');
  assert.equal(replaceToken(text,token,''),'查看 后文');
  for(const text of ['mail@host','first.last@example.com','https://example.com/path','https://user@host','https://example.com/中文/path','/usr/local/bin']){
    const token=composerToken(text,text.length);
    if(text.startsWith('/usr'))assert.equal(token.query,'usr/local/bin');
    else assert.equal(token,null,text);
  }
});
test('direct send handles only exact local commands and respects upstream names',()=>{
  assert.equal(commandPanel(' /files\n',[]),'files');
  assert.equal(commandPanel('/files src',[]),null);
  assert.equal(commandPanel('请查看 /files',[]),null);
  assert.equal(commandPanel('/files',[{name:'files'}]),null);
  assert.equal(commandPanel('/not-advertised',[]),null);
});

import {codeLines} from '../apps/desktop/src/code-lines.ts';
test('unified diff line numbers and counts exclude headers and follow hunk ranges',()=>{
  const parsed=codeLines('--- a/main.js\n+++ b/main.js\n@@ -3,2 +3,3 @@\n kept\n-old\n+new\n+extra\n',true);
  assert.equal(parsed.added,2);assert.equal(parsed.removed,1);
  assert.deepEqual(parsed.rows.map(row=>[row.line,row.kind]),[[3,'plain'],[4,'removed'],[4,'added'],[5,'added']]);
  assert.deepEqual(codeLines('').rows,[]);
  assert.equal(codeLines('x\n'.repeat(5001)).clipped,true);
});

import {canConfigure,configChoices} from '../apps/desktop/src/agent-config.ts';
test('ACP config supports grouped values and enforces UI execution/device states',()=>{
 assert.deepEqual(configChoices({type:'select',options:[{name:'Models',options:[{value:'m1',name:'Model one'},{value:42}]}]}),[{value:'m1',name:'Model one',group:'Models'}]);
 assert.equal(configChoices({type:'_future',options:[{value:'x'}]}).length,0);
 assert.equal(canConfigure({status:'running'},{phase:'online'}),false);
 assert.equal(canConfigure({status:'idle',queue:[]},{phase:'online',device:{role:'viewer'}}),false);
 assert.equal(canConfigure({status:'idle',queue:[]},{phase:'online',device:{role:'operator'}}),true);
 assert.equal(canConfigure({status:'idle',historyOnly:true},{phase:'online'}),false);
});

import {recentSessions,sessionGroups} from '../apps/desktop/src/session-groups.ts';
test('project grouping uses authorized workspace paths and keeps every session exactly once',()=>{
 const sessions=[{id:'a',workspace:'/one'},{id:'b',workspace:'/two'},{id:'c',workspace:'/one'}];
 const groups=sessionGroups(sessions,[{path:'/one',name:'Project One'}]);
 assert.deepEqual(groups.map(group=>[group.name,group.sessions.map(session=>session.id)]),[['Project One',['a','c']],['two',['b']]]);
 assert.equal(sessionGroups([],[]).length,0);
});

test('recent sessions sort by persisted activity and fall back to legacy Run times without mutating the source',()=>{
 const sessions=[{id:'a',lastActivityAt:10},{id:'b',runs:[{createdAt:30}]},{id:'c',lastActivityAt:20}];
 assert.deepEqual(recentSessions(sessions).map(session=>session.id),['b','c','a']);
 assert.deepEqual(sessions.map(session=>session.id),['a','b','c']);
});

import {discoverComposerSkills} from '../apps/desktop/src/composer-skills.ts';
test('project skill discovery uses authorized paths, ignores symlinks and preserves source identities',async()=>{
 const dir=(name,path=name)=>({name,path,kind:'directory'}), file=name=>({name,kind:'file'});
 const trees={'.':{entries:[dir('.agents'),dir('.claude')]},'.agents':{entries:[dir('skills')]},'.claude':{entries:[dir('skills')]},'.agents/skills':{entries:[dir('review','.agents/skills/review'),{name:'linked',kind:'symlink'}]},'.claude/skills':{entries:[dir('review','.claude/skills/review'),dir('empty','.claude/skills/empty')]},'.agents/skills/review':{entries:[file('SKILL.md')]},'.claude/skills/review':{entries:[file('SKILL.md')]},'.claude/skills/empty':{entries:[]}};
 const paths=[];
 const skills=await discoverComposerSkills(async url=>{if(url.includes('/file?'))return {text:'---\ndescription: Review project code\n---\n'};assert.ok(url.startsWith('/sessions/session%20id/tree?'));const path=new URL(url,'http://host').searchParams.get('path');paths.push(path);assert.ok(trees[path],path);return trees[path];},'session id');
 assert.equal(skills.length,2);
 assert.equal(skills[0].description,'Review project code');
 assert.notEqual(skills[0].path,skills[1].path);
 assert.equal(commandOptions([],'review',skills).length,2);
 assert.equal(commandOptions([{name:'review'}],'review',skills).length,1);
 assert.equal(paths.some(path=>path.includes('linked')),false);
});
test('skill discovery reports real read failures rather than presenting a false empty catalog',async()=>{
 await assert.rejects(discoverComposerSkills(async()=>{throw Error('offline');},'session'),/offline/);
 assert.deepEqual(await discoverComposerSkills(async()=>({entries:[]}), 'session'),[]);
});

test('@ groups real files and skills without shadowing names or following links',()=>{
 const entries=[{name:'review',kind:'file'},{name:'review-dir',kind:'directory'},{name:'review-link',kind:'symlink'}];
 const skills=[{name:'review',kind:'skill',path:'.agents/skills/review/SKILL.md'}];
 assert.deepEqual(referenceOptions(entries,'review',skills).map(item=>item.kind),['directory','file','skill']);
 assert.equal(referenceOptions(entries,'review',skills,'src/').some(item=>item.kind==='skill'),false);
 assert.equal(referenceOptions(entries,'SKILL.md',skills)[0].path,skills[0].path);
 assert.deepEqual(referenceOptions(undefined,'missing',skills),[]);
 assert.deepEqual(entries.map(item=>item.kind),['file','directory','symlink']);
});

test('original-context selection does not enable mode changes before the connection is restored',()=>{
 assert.equal(canConfigure({status:'idle',agentState:{contextRestoreState:'pending'}},{phase:'online'}),false);
 assert.equal(canConfigure({status:'idle',agentState:{contextRestoreState:'restored'}},{phase:'online'}),true);
});

test('choosing inside a trigger replaces its complete suffix but preserves following prose',()=>{
 const text='查看 @preview.txt 然后解释';
 const token=composerToken(text,7);
 assert.equal(token.query,'pre');
 assert.equal(replaceToken(text,token,''),'查看  然后解释');
 const command='/terminal 继续';
 assert.equal(replaceToken(command,composerToken(command,4),'/files '),'/files  继续');
 const quoted='看 @"folder name/file.txt" 后文';
 assert.equal(replaceToken(quoted,composerToken(quoted,10),''),'看  后文');
});

import {remotePreferences} from '../apps/desktop/src/remote-preferences.ts';
test('remote settings hydrate saved intent, actual IP and legacy Host addresses separately',()=>{
 assert.deepEqual(remotePreferences({configuration:{enabled:false,ip:'127.0.0.2',port:0},suggestedIp:'192.168.1.2'}),{ip:'127.0.0.2',port:'0'});
 assert.deepEqual(remotePreferences({url:'https://127.0.0.3:1234',configuration:{ip:'127.0.0.2',port:0}}),{ip:'127.0.0.3',port:'0'});
 assert.deepEqual(remotePreferences({url:'https://[::1]:1234'}),{ip:'::1',port:'1234'});
 assert.deepEqual(remotePreferences({suggestedIp:'192.168.1.2',configuration:{port:99999}}),{ip:'192.168.1.2',port:'0'});
 assert.deepEqual(remotePreferences(null),{ip:'',port:'0'});
});


import {devicePresentation} from '../apps/desktop/src/remote-preferences.ts';
test('device display uses Host status, real scopes and legacy expiry without claiming invalid grants active',()=>{
 const grant={id:'phone',name:'Phone',role:'viewer',workspaces:['one','missing'],expiresAt:200,revoked:false};
 assert.equal(devicePresentation(grant,[],300).label,'已过期');
 assert.equal(devicePresentation({...grant,status:'active'},[],300).label,'已授权','Host status survives a skewed client clock');
 assert.equal(devicePresentation({...grant,status:'invalid'},[],100).label,'记录异常');
 assert.equal(devicePresentation({...grant,revoked:true},[],100).label,'已撤销');
 assert.equal(devicePresentation({...grant,role:'constructor'},[],100).role,'未知角色');
 assert.equal(devicePresentation({...grant,role:'future'},[],100).label,'记录异常');
 assert.equal(devicePresentation({...grant,expiresAt:null},[],100).expires,null);
 assert.deepEqual(devicePresentation(grant,[{id:'one',name:'Project One'}],100).scopes,['Project One','未找到的工作区（missing）']);
});

test('diff metadata stays hidden across files without dropping header-like source lines',()=>{
 const parsed=codeLines('diff --git a/a b/a\nindex 1..2\n--- a/a\n+++ b/a\n@@ -2,1 +2,1 @@\n--- old\n+++ new\ndiff --git a/b b/b\n--- a/b\n+++ b/b\n@@ -1,1 +1,1 @@\n-before\n+after\n',true);
 assert.equal(parsed.added,2);assert.equal(parsed.removed,2);
 assert.deepEqual(parsed.rows.map(row=>row.line),[2,2,1,1]);
 assert.deepEqual(parsed.rows.map(row=>row.text),['--- old','+++ new','-before','+after']);
});

import {groupReferenceText,configCategory} from '../apps/desktop/src/composer.ts';
test('group references deliver authorized text and reject binary or oversized context',async()=>{
 const read=async url=>url.includes('/tree?')?{entries:[{path:'docs/a.md'}]}:{text:'source text'};
 const prompt=await groupReferenceText(read,'group id','review',['a.md','docs/']);
 assert.match(prompt,/source text/);assert.match(prompt,/docs\/a.md/);
 await assert.rejects(groupReferenceText(async()=>({binary:true,text:''}),'group','review',['a.png']),/二进制/);
 await assert.rejects(groupReferenceText(async()=>({text:'中'.repeat(5000)}),'group','review',['a.md']),/大小限制/);
 assert.equal(configCategory({category:'thought_level',configId:'reasoning_effort'}),'reasoning');
 assert.equal(configCategory({category:'model'}),'model');
 assert.equal(configCategory({configId:'reasoning_effort'}),'reasoning');
});

test('Agent advertised dollar skills belong to skills, keep their wire command and prefer project skills',()=>{
 const options=commandOptions([{name:'plan'},{name:'$reviewer',description:'Review code'},{name:'$local'}],'',[{name:'local',kind:'skill',path:'.agents/skills/local/SKILL.md'}]);
 assert.equal(options.find(o=>o.name==='plan').source,'Agent 指令');
 const skill=options.find(o=>o.name==='reviewer');assert.equal(skill.kind,'skill');assert.equal(skill.nativeCommand,'$reviewer');assert.equal(skill.source,'Agent 技能');
 assert.equal(options.filter(o=>o.name==='local').length,1);assert.equal(options.find(o=>o.name==='local').path,'.agents/skills/local/SKILL.md');
});

import {referenceRequest} from '../apps/desktop/src/composer.ts';
test('reference requests browse complete directories and search full relative paths',()=>{
 assert.equal(referenceRequest('session','').path,'/sessions/session/tree?path=.');
 assert.equal(referenceRequest('session','docs/guides/').path,'/sessions/session/tree?path=docs%2Fguides%2F');
 assert.equal(referenceRequest('session','tests/arti').path,'/sessions/session/references?query=tests%2Farti');
 assert.equal(referenceRequest('session','sample').browsing,false);
 assert.equal(referenceRequest('session','my folder/子文件',true).path,'/sessions/session/references?query=my%20folder%2F%E5%AD%90%E6%96%87%E4%BB%B6&refresh=true');
});
