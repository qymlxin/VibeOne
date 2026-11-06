import test from 'node:test';
import assert from 'node:assert/strict';
import {composerToken,replaceToken,commandOptions} from '../apps/desktop/src/composer.js';
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
