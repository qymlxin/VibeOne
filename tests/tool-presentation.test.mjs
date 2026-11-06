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
