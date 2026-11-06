import {cpSync,mkdirSync,readFileSync,realpathSync,writeFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,join,relative,resolve,isAbsolute,sep} from 'node:path';
export const bridgePackages=[['codex-acp','@agentclientprotocol/codex-acp'],['claude-agent-acp','@agentclientprotocol/claude-agent-acp']];

// Retain the installed Node resolution tree, including nested conflicting versions.
export function packageBridges(root,destination,entries=bridgePackages){
 const modules=realpathSync(join(root,'node_modules')),copied=new Map();
 const lockPath=join(root,'package-lock.json');
 const locked=existsSync(lockPath)?JSON.parse(readFileSync(lockPath,'utf8')).packages:null;
 const locate=(name,from)=>{
  const search=createRequire(join(from,'package.json')).resolve.paths(name)??[];
  return search.map(path=>join(path,name)).find(path=>{
   if(!existsSync(join(path,'package.json')))return false;
   const located=relative(modules,realpathSync(path));
   return located!=='..'&&!located.startsWith(`..${sep}`)&&!isAbsolute(located);
  });
 };
 const copy=source=>{
  source=realpathSync(source);
  const path=relative(modules,source);
  if(path.startsWith(`..${sep}`)||path==='..'||isAbsolute(path))throw Error(`Bridge dependency is outside the locked node_modules tree: ${source}`);
  if(copied.has(source))return copied.get(source);
  const manifest=JSON.parse(readFileSync(join(source,'package.json'),'utf8'));
  const lockKey=`node_modules/${path.split(sep).join('/')}`;
  if(locked&&locked[lockKey]?.version!==manifest.version)throw Error(`Bridge dependency differs from package-lock.json: ${lockKey}; run npm ci`);
  const target=join(destination,'node_modules',path);
  const record={name:manifest.name,version:manifest.version,path:`node_modules/${path.split(sep).join('/')}`};
  copied.set(source,record);mkdirSync(dirname(target),{recursive:true});
  cpSync(source,target,{recursive:true,dereference:true,filter:path=>!relative(source,path).split(sep).includes('node_modules')});
  const required={...manifest.dependencies};
  for(const [name,version] of Object.entries(manifest.peerDependencies??{}))if(!manifest.peerDependenciesMeta?.[name]?.optional)required[name]=version;
  for(const name of new Set([...Object.keys(required),...Object.keys(manifest.optionalDependencies??{})])){
   const dependency=locate(name,source);
   if(!dependency){if(Object.hasOwn(required,name)&&!Object.hasOwn(manifest.optionalDependencies??{},name))throw Error(`Missing bridge runtime dependency ${name} required by ${manifest.name}`);continue;}
   copy(dependency);
  }
  return record;
 };
 mkdirSync(destination,{recursive:true});
 writeFileSync(join(destination,'package.json'),JSON.stringify({private:true,type:'module'},null,2));
 const bridges=[];
 for(const [binary,name] of entries){
  const source=locate(name,resolve(root));if(!source)throw Error(`Missing locked bridge ${name}; run npm ci`);
  const record=copy(source),manifest=JSON.parse(readFileSync(join(source,'package.json'),'utf8'));
  const bin=typeof manifest.bin==='string'?manifest.bin:manifest.bin?.[binary];
  if(!bin||isAbsolute(bin)||bin.split(/[\\/]/).includes('..'))throw Error(`Invalid bridge entrypoint ${binary}`);
  const entry=`./${record.path}/${bin.replace(/^\.\//,'')}`;
  writeFileSync(join(destination,binary),`#!/usr/bin/env node\nimport ${JSON.stringify(entry)};\n`,{mode:0o755});
  bridges.push({binary,name,version:manifest.version,entry});
 }
 const manifest={platform:process.platform,architecture:process.arch,bridges,packages:[...copied.values()]};
 writeFileSync(join(destination,'bridge-manifest.json'),JSON.stringify(manifest,null,2));
 return manifest;
}
