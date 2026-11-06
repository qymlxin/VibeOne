import {spawnSync} from 'node:child_process';
const build=spawnSync('cargo',['build','-p','vibeone-host'],{stdio:'inherit'});
if(build.status!==0)process.exit(build.status??1);
const run=spawnSync(process.execPath,['--test','tests/context-resume.test.mjs'],{stdio:'inherit',env:{...process.env,VIBEONE_RESUME_BROWSER:'1'}});
process.exit(run.status??1);
