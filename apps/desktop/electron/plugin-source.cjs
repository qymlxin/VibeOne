const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const fs=require('node:fs/promises');const path=require('node:path');const crypto=require('node:crypto');
const exec=promisify(execFile);
function repositoryUrl(value){const url=new URL(value);if(url.protocol!=='https:'||url.hostname!=='github.com'||url.username||url.password||url.search||url.hash||!/^\/[\w.-]+\/[\w.-]+(?:\.git)?\/?$/.test(url.pathname))throw Error('请输入 GitHub 仓库地址');return `https://github.com/${url.pathname.split('/').filter(Boolean).join('/').replace(/\.git$/,'')}.git`;}
async function discoverPluginPackages(checkout,source){
 const root=await fs.realpath(checkout),packages=[],warnings=[];let visited=0;
 const walk=async(directory,depth)=>{
  if(++visited>5000)throw Error('仓库目录过多，请缩小插件仓库');
  const manifestPath=path.join(directory,'plugin.json');
  try{
   const info=await fs.lstat(manifestPath);
   if(!info.isFile()||info.size>65536)throw Error('清单必须是64KiB以内的普通文件');
   const manifest=JSON.parse(await fs.readFile(manifestPath,'utf8'));
   packages.push({path:directory,source:{...source,directory:path.relative(root,directory).split(path.sep).join('/')},manifest});
   if(packages.length>64)throw Error('仓库插件超过64个');
   return;
  }catch(error){if(error.code!=='ENOENT'){
    if(packages.length>64)throw error;
    warnings.push(`${path.relative(root,directory)||'.'}：${error.message}`);
    return;
   }}
  if(depth>=8){warnings.push(`${path.relative(root,directory)}：超过8层扫描深度，已跳过`);return;}
  const entries=await fs.readdir(directory,{withFileTypes:true});
  for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name)))if(entry.isDirectory()&&!entry.name.startsWith('.')&&!['node_modules','dist','target','build','vendor'].includes(entry.name))await walk(path.join(directory,entry.name),depth+1);
 };
 await walk(root,0);
 return {packages,warnings,source};
}
async function fetchPluginSource(data,input){
 const repository=repositoryUrl(input.repository),base=path.join(data,'plugin-downloads');await fs.mkdir(base,{recursive:true,mode:0o700});
 const checkout=path.join(base,crypto.randomUUID());const options={timeout:120000,maxBuffer:1024*1024,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GIT_SSH_COMMAND:'ssh -o BatchMode=yes -o ConnectTimeout=15'}};
 try{
  try{await exec('git',['clone','--depth','1','--no-recurse-submodules','--',repository,checkout],options);}
  catch{await fs.rm(checkout,{recursive:true,force:true});await exec('git',['clone','--depth','1','--no-recurse-submodules','--',repository.replace('https://github.com/','git@github.com:'),checkout],options);}
  const revision=(await exec('git',['-C',checkout,'rev-parse','HEAD'],options)).stdout.trim();
  if(input.directory===undefined)return await discoverPluginPackages(checkout,{repository:repository.replace(/\.git$/,''),revision});
  const directory=String(input.directory??'').replace(/\\/g,'/');if(directory.startsWith('/')||directory.split('/').some(p=>p==='..')||directory.includes('\0'))throw Error('插件目录必须是仓库内相对路径');
  const checkoutRoot=await fs.realpath(checkout),packagePath=await fs.realpath(path.join(checkout,directory));if(packagePath!==checkoutRoot&&!packagePath.startsWith(checkoutRoot+path.sep))throw Error('插件目录超出仓库');
  await fs.access(path.join(packagePath,'plugin.json'));
  return {path:packagePath,source:{repository:repository.replace(/\.git$/,''),directory,revision}};
 }catch(error){await fs.rm(checkout,{recursive:true,force:true});throw Error(`插件下载失败：${String(error.message).slice(0,350)}`);}
}
module.exports={fetchPluginSource,repositoryUrl,discoverPluginPackages};
