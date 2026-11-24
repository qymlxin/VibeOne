import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync,mkdirSync,renameSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve,join} from 'node:path';
import {homedir} from 'node:os';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
if(!existsSync(join(root,'target/desktop-resources/bin/vibeone-host'))){
  execFileSync(process.execPath,[join(root,'scripts/prepare-desktop.mjs')],{cwd:root,stdio:'inherit'});
}
execFileSync('npm',['run','build:electron','-w','@vibeone/desktop'],{cwd:root,stdio:'inherit'});
if(process.platform!=='darwin'){
  execFileSync(join(root,'node_modules/.bin/electron'),[join(root,'apps/desktop/dist-electron/dev-bootstrap.cjs')],{cwd:root,stdio:'inherit'});
}else{
  const destination=join(homedir(),'Applications/VibeOne.app');
  if(!existsSync(destination)){
    let seed=process.env.VIBEONE_DEV_SEED;
    if(!seed){
      execFileSync('npm',['run','desktop:bundle'],{cwd:root,stdio:'inherit'});
      seed=join(root,`target/desktop-builds.noindex/VibeOne-darwin-${process.arch}/VibeOne.app`);
    }
    mkdirSync(dirname(destination),{recursive:true});renameSync(seed,destination);
  }
  const resources=join(destination,'Contents/Resources/app');
  const manifest=join(resources,'package.json');
  const pkg=JSON.parse(readFileSync(manifest,'utf8'));
  if(pkg.name!=='vibeone')throw Error('目标位置已被其他应用占用');
  pkg.main='electron/dev-source.cjs';
  writeFileSync(join(resources,'electron/dev-source.cjs'),`require(${JSON.stringify(join(root,'apps/desktop/dist-electron/dev-bootstrap.cjs'))});\n`);
  writeFileSync(manifest,JSON.stringify(pkg));
  console.log(`固定开发应用：${destination}`);
  if(!process.argv.includes('--setup-only'))execFileSync('open',[destination]);
}
