import test from 'node:test';
import assert from 'node:assert/strict';
import {composerToken,replaceToken,commandOptions,commandPanel,referenceOptions} from '../apps/desktop/src/composer.js';
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
  assert.equal(options.find(option=>option.name==='files').source,'Agent');
  assert.equal(commandOptions(null,'终端')[0].panel,'terminal');
  assert.equal(commandOptions([], 'does-not-exist').length,0);
});
test('direct send handles only exact local commands and respects upstream names',()=>{
  assert.equal(commandPanel(' /files\n',[]),'files');
  assert.equal(commandPanel('/files src',[]),null);
  assert.equal(commandPanel('请查看 /files',[]),null);
  assert.equal(commandPanel('/files',[{name:'files'}]),null);
  assert.equal(commandPanel('/not-advertised',[]),null);
});

import {codeLines} from '../apps/desktop/src/code-lines.js';
test('unified diff line numbers and counts exclude headers and follow hunk ranges',()=>{
  const parsed=codeLines('--- a/main.js\n+++ b/main.js\n@@ -3,2 +3,3 @@\n kept\n-old\n+new\n+extra\n',true);
  assert.equal(parsed.added,2);assert.equal(parsed.removed,1);
  assert.deepEqual(parsed.rows.slice(3).map(row=>[row.line,row.kind]),[[3,'plain'],[4,'removed'],[4,'added'],[5,'added']]);
  assert.deepEqual(codeLines('').rows,[]);
  assert.equal(codeLines('x\n'.repeat(5001)).clipped,true);
});

import {canConfigure,configChoices} from '../apps/desktop/src/agent-config.js';
test('ACP config supports grouped values and enforces UI execution/device states',()=>{
 assert.deepEqual(configChoices({type:'select',options:[{name:'Models',options:[{value:'m1',name:'Model one'},{value:42}]}]}),[{value:'m1',name:'Model one',group:'Models'}]);
 assert.equal(configChoices({type:'_future',options:[{value:'x'}]}).length,0);
 assert.equal(canConfigure({status:'running'},{phase:'online'}),false);
 assert.equal(canConfigure({status:'idle',queue:[]},{phase:'online',device:{role:'viewer'}}),false);
 assert.equal(canConfigure({status:'idle',queue:[]},{phase:'online',device:{role:'operator'}}),true);
 assert.equal(canConfigure({status:'idle',historyOnly:true},{phase:'online'}),false);
});

import {recentSessions,sessionGroups} from '../apps/desktop/src/session-groups.js';
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

import {discoverComposerSkills} from '../apps/desktop/src/composer-skills.js';
test('project skill discovery uses authorized paths, ignores symlinks and preserves source identities',async()=>{
 const dir=(name,path=name)=>({name,path,kind:'directory'}), file=name=>({name,kind:'file'});
 const trees={'.':{entries:[dir('.agents'),dir('.claude')]},'.agents':{entries:[dir('skills')]},'.claude':{entries:[dir('skills')]},'.agents/skills':{entries:[dir('review','.agents/skills/review'),{name:'linked',kind:'symlink'}]},'.claude/skills':{entries:[dir('review','.claude/skills/review'),dir('empty','.claude/skills/empty')]},'.agents/skills/review':{entries:[file('SKILL.md')]},'.claude/skills/review':{entries:[file('SKILL.md')]},'.claude/skills/empty':{entries:[]}};
 const paths=[];
 const skills=await discoverComposerSkills(async url=>{assert.ok(url.startsWith('/sessions/session%20id/tree?'));const path=new URL(url,'http://host').searchParams.get('path');paths.push(path);assert.ok(trees[path],path);return trees[path];},'session id');
 assert.equal(skills.length,2);
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
