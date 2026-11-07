import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
test('author tool creates TS sources and packs loadable JavaScript without source runtime dependencies',async t=>{
  const root=await mkdtemp(join(tmpdir(),'vibeone-author-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const cli=resolve('scripts/plugin.mjs'),source=join(root,'source'),destination=join(root,'package');
  await exec(process.execPath,[cli,'create',source]);
  await exec(process.execPath,[cli,'pack',source,destination]);
  await exec(process.execPath,[cli,'check',destination]);
  await assert.rejects(exec(process.execPath,[cli,'pack',source,join(source,'nested-output')]),/Output must be outside the source package/);
  const manifest=JSON.parse(await readFile(join(destination,'plugin.json'),'utf8'));
  assert.equal(manifest.entrypoints.app.path,'dist/app.js');
  assert.ok((await readFile(join(destination,'dist/worker.js'),'utf8')).includes('defineWorker'));
});
