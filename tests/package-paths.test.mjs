import test from 'node:test';
import assert from 'node:assert/strict';
import {posix,win32} from 'node:path';
import {containsPackagePath} from '../scripts/package-paths.mjs';

test('package containment uses platform paths without accepting sibling prefixes, traversal or other drives',()=>{
 for(const [paths,root,inside,outside] of [
  [posix,'/plugins/example',['/plugins/example','/plugins/example/dist/app.js','/plugins/example/space name/file'],['/plugins/example-other/app.js','/plugins/example/../outside/app.js','/other/app.js']],
  [win32,'C:\\plugins\\example',['C:\\plugins\\example','C:\\plugins\\example\\dist\\app.js','c:\\PLUGINS\\example\\dist\\app.js','C:/plugins/example/dist/app.js'],['C:\\plugins\\example-other\\app.js','C:\\plugins\\example\\..\\outside\\app.js','D:\\plugins\\example\\dist\\app.js']],
  [win32,'\\\\server\\share\\plugin',['\\\\server\\share\\plugin\\dist\\app.js'],['\\\\server\\share\\plugin-other\\app.js','\\\\server\\other-share\\plugin\\app.js']],
 ]){
  for(const target of inside)assert.equal(containsPackagePath(root,target,paths),true,target);
  for(const target of outside)assert.equal(containsPackagePath(root,target,paths),false,target);
 }
});
