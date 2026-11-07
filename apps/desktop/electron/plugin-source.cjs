const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const fs=require('node:fs/promises');const path=require('node:path');const crypto=require('node:crypto');
const exec=promisify(execFile);
function repositoryUrl(value){const url=new URL(value);if(url.protocol!=='https:'||url.hostname!=='github.com'||url.username||url.password||url.search||url.hash||!/^\/[\w.-]+\/[\w.-]+(?:\.git)?\/?$/.test(url.pathname))throw Error('请输入 GitHub 仓库地址');return `https://github.com/${url.pathname.split('/').filter(Boolean).join('/').replace(/\.git$/,'')}.git`;}
async function fetchPluginSource(data,input){
 const repository=repositoryUrl(input.repository),base=path.join(data,'plugin-downloads');await fs.mkdir(base,{recursive:true,mode:0o700});
 const checkout=path.join(base,crypto.randomUUID());const options={timeout:120000,maxBuffer:1024*1024,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GIT_SSH_COMMAND:'ssh -o BatchMode=yes -o ConnectTimeout=15'}};
 try{
  try{await exec('git',['clone','--depth','1','--no-recurse-submodules','--',repository,checkout],options);}
  catch{await fs.rm(checkout,{recursive:true,force:true});await exec('git',['clone','--depth','1','--no-recurse-submodules','--',repository.replace('https://github.com/','git@github.com:'),checkout],options);}
  const revision=(await exec('git',['-C',checkout,'rev-parse','HEAD'],options)).stdout.trim();
  const directory=String(input.directory??'').replace(/\\/g,'/');if(directory.startsWith('/')||directory.split('/').some(p=>p==='..')||directory.includes('\0'))throw Error('插件目录必须是仓库内相对路径');
  const checkoutRoot=await fs.realpath(checkout),packagePath=await fs.realpath(path.join(checkout,directory));if(packagePath!==checkoutRoot&&!packagePath.startsWith(checkoutRoot+path.sep))throw Error('插件目录超出仓库');
  await fs.access(path.join(packagePath,'plugin.json'));
  return {path:packagePath,source:{repository:repository.replace(/\.git$/,''),directory,revision}};
 }catch(error){await fs.rm(checkout,{recursive:true,force:true});throw Error(`插件下载失败：${String(error.message).slice(0,350)}`);}
}
module.exports={fetchPluginSource,repositoryUrl};
