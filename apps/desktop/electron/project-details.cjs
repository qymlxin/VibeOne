const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const os=require('node:os');
const git=promisify(execFile);
async function projectDetails(projects,ids){
 if(!Array.isArray(ids)||ids.length>64||ids.some(id=>typeof id!=='string'))throw Error('项目列表无效');
 const allowed=projects.filter(p=>ids.includes(p.id)),result=[];
 for(let offset=0;offset<allowed.length;offset+=4){
  result.push(...await Promise.all(allowed.slice(offset,offset+4).map(async project=>{
   const directory=project.paths?.[0];let branch=null;
   if(directory)try{const value=await git('git',['-C',directory,'symbolic-ref','--quiet','--short','HEAD'],{encoding:'utf8',timeout:1800,maxBuffer:16384,windowsHide:true,env:{...process.env,GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0'}});branch=value.stdout.trim()||null;}catch{}
   return {id:project.id,path:directory??null,branch};
  })));
 }
 return {projects:result,homeDirectory:os.homedir()};
}
module.exports={projectDetails};
