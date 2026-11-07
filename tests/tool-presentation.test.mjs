import test from 'node:test';
import assert from 'node:assert/strict';
import {describeTool,parseToolValue,safeToolUrl} from '../apps/desktop/src/tool-presentation.js';

test('Codex web actions show complete queries and distinguish page opens without leaking transport ids into presentation',()=>{
 const search=describeTool({rawInput:{type:'webSearch',id:'transport',query:'truncated...',action:{type:'search',queries:['first query','second query']}}});
 assert.deepEqual(describeTool({rawInput:{type:'webSearch',query:'fallback',action:{queries:[]}}}).fields[0].value,['fallback']);
 assert.equal(search.kind,'search');assert.deepEqual(search.fields[0].value,['first query','second query']);
 assert.equal(JSON.stringify(search.fields).includes('transport'),false);
 const open=describeTool({rawInput:JSON.stringify({type:'webSearch',action:{type:'openPage',url:'https://example.com/docs'}})});
 assert.equal(describeTool({rawInput:{type:'webSearch',action:{type:'findInPage',url:'https://example.com',pattern:'match'}}}).fields[1].value,'match');
 assert.equal(open.kind,'web');assert.equal(open.fields[0].value,'https://example.com/docs');
});

test('commands preserve arguments, exit zero, ACP text, file diffs and unknown structured values',()=>{
 const command=describeTool({rawInput:{command:['printf','hello world'],cwd:'/workspace'},rawOutput:{exit_code:0},content:[{type:'content',content:{type:'text',text:'hello world'}}]});
 assert.equal(command.kind,'command');assert.deepEqual(command.fields[0].value,['printf','hello world']);
 assert.equal(command.outputs[0].value.exit_code,0);assert.equal(command.outputs[1].value,'hello world');
 const file=describeTool({rawInput:{file_path:'src/main.rs'},content:[{type:'diff',path:'src/main.rs',oldText:'old',newText:'new'}]});
 assert.equal(file.kind,'file');assert.equal(file.outputs[0].newText,'new');
 assert.deepEqual(describeTool({rawInput:{custom:{enabled:false,limit:0}}}).fields[0].value,{custom:{enabled:false,limit:0}});
 assert.equal(parseToolValue('{partial'),'{partial');
 assert.deepEqual(describeTool({output:'same',content:[{type:'content',content:{type:'text',text:'same'}}]}).outputs,[{type:'value',value:'same'}]);
});

test('only HTTP and HTTPS tool links are clickable',()=>{
 assert.equal(safeToolUrl('https://example.com/path'),'https://example.com/path');
 for (const value of ['javascript:alert(1)','data:text/html,x','file:///etc/passwd','not a URL']) assert.equal(safeToolUrl(value),null);
});

import {remarkSoftBreaks} from '../apps/desktop/src/markdown-layout.js';
test('soft line breaks stay inside paragraphs without touching code indentation or inventing block spacing',()=>{
 const tree={type:'root',children:[{type:'paragraph',children:[{type:'text',value:'title\ndescription'}]},{type:'code',value:'  first\n    second'}]};
 remarkSoftBreaks()(tree);
 assert.deepEqual(tree.children[0].children.map(child=>child.type),['text','break','text']);
 assert.equal(tree.children.length,2);
 assert.equal(tree.children[1].value,'  first\n    second');
});

import {describeAction} from '../apps/desktop/src/tool-presentation.js';
test('semantic reads use explicit ACP file paths, never infer reads from arbitrary shell',()=>{
 assert.deepEqual(describeAction({kind:'read',status:'completed',locations:[{path:'/project/a.ts'},{path:'/project/a.ts'}]}),{paths:['/project/a.ts'],operation:'read',label:'已读取'});
 assert.deepEqual(describeAction({kind:'read',title:"Read file '/project/b.ts'"}).paths,['/project/b.ts']);
 assert.equal(describeAction({kind:'execute',rawInput:{command:'cat /project/a.ts'}}).operation,null);
 assert.equal(describeAction({kind:'read',title:"List files in '/project'"}).operation,null);
});

import {previewUrl,workspacePath} from '../apps/desktop/src/preview-links.js';
test('preview links separate web URLs and workspace paths, rejecting traversal and embedded credentials',()=>{
 assert.equal(previewUrl('https://example.com/docs'),'https://example.com/docs');
 for(const value of ['javascript:alert(1)','https://name:secret@example.com','file:///tmp/a'])assert.equal(previewUrl(value),null);
 assert.equal(workspacePath('/workspace/src/a.ts#L12','/workspace'),'src/a.ts');
 assert.equal(workspacePath('file:///workspace/src/a.ts','/workspace'),'src/a.ts');
 for(const value of ['../secret','%2e%2e/secret','/other/a','file://remote/workspace/a','https://example.com/a','C:\\private'])assert.equal(workspacePath(value,'/workspace'),null);
});

import {normalizeAppearance,contrastRatio} from '../apps/desktop/src/appearance.js';
test('appearance storage accepts only six-digit colors and isolates light and dark values',()=>{
 const value=normalizeAppearance({accent:'url(javascript:x)',light:{background:'#f4f1eb',foreground:'red'},dark:{foreground:'#FFFFFF'}});
 assert.equal(value.accent,'#3564F5');assert.deepEqual(value.light,{background:'#f4f1eb'});assert.deepEqual(value.dark,{foreground:'#FFFFFF'});
 assert.ok(contrastRatio('#FFFFFF','#181818')>17);assert.equal(contrastRatio('#FFFFFF','#FFFFFF'),1);
});

test('ACP patch updates retain changed paths and the actual Git patch',()=>{
 const patch='diff --git a/a.rs b/a.rs\n@@ -1 +1 @@\n-old\n+new\n';
 const tool={kind:'edit',status:'completed',title:'Editing files',content:[{type:'diff',changes:[{operation:'modify',path:'/workspace/a.rs'}],patch:{format:'git_patch',text:patch}}]};
 assert.deepEqual(describeAction(tool).paths,['/workspace/a.rs']);
 assert.equal(describeTool(tool).outputs[0].patch,patch);
 assert.equal(describeTool(tool).outputs[0].path,'/workspace/a.rs');
});
