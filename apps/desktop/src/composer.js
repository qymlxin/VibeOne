// Query by the caret prefix, replace the complete token, preserve surrounding prose.
export function composerToken(text, caret) {
  const prefix = text.slice(0, caret);
  const suffix = text.slice(caret);
  const word=prefix.match(/\S*$/)?.[0]??'';
  if(/^[a-z][a-z\d+.-]*:\/\//i.test(word))return null;
  // Chinese prose does not normally separate words with spaces. Treat Han
  // characters and Chinese punctuation as boundaries, but leave email/URL
  // fragments alone (ASCII letters, ':' and '/' are not boundaries).
  const quoted=/(?:^|[\s\p{Script=Han}，。！？：；、（【「『])@"([^"\n]*)$/u.exec(prefix);
  if(quoted)return {kind:'@',query:quoted[1],start:prefix.length-quoted[1].length-2,end:caret+(suffix.match(/^[^"\n]*(?:")?/)?.[0].length??0)};
  const match = /(?:^|[\s\p{Script=Han}，。！？：；、（【「『])([@/])([^\s]*)$/u.exec(prefix);
  if (!match) return null;
  return {kind:match[1], query:match[2], start:prefix.length-match[2].length-1, end:caret+(suffix.match(/^[^\s]*/)?.[0].length??0)};
}
export function replaceToken(text, token, value) {
  return text.slice(0,token.start)+value+text.slice(token.end);
}
export function referenceOptions(entries, query, skills = [], directory = '') {
  const needle=query.toLowerCase();
  const files=(entries??[]).filter(item=>['file','directory'].includes(item.kind)&&item.name.toLowerCase().includes(needle))
    .sort((a,b)=>(a.kind==='directory'?0:1)-(b.kind==='directory'?0:1)||a.name.localeCompare(b.name));
  const matchingSkills=directory?[]:skills.filter(item=>(item.name+' '+item.path).toLowerCase().includes(needle));
  return [...files,...matchingSkills];
}
export const localCommands = [
  {name:'files',label:'文件',description:'打开工作区文件',panel:'files'},
  {name:'changes',label:'变更',description:'查看工作区变更',panel:'changes'},
  {name:'terminal',label:'终端',description:'打开交互 Shell，执行命令',panel:'terminal'},
  {name:'runs',label:'执行记录',description:'查看执行记录',panel:'runs'},
  {name:'artifacts',label:'产物',description:'查看会话生成的产物',panel:'artifacts'},
  {name:'agent',label:'Agent 设置',description:'查看当前 Agent 配置',panel:'agent'},
];
export const sessionCommands = [
  {name:'model',label:'模型',description:'选择当前 Agent 使用的模型',control:'model',source:'会话控制'},
  {name:'reasoning',label:'思考强度',description:'调整推理投入与处理深度',control:'reasoning',source:'会话控制'},
  {name:'mode',label:'工作模式',description:'选择 Agent 提供的执行模式',control:'mode',source:'会话控制'},
];
export function commandOptions(commands, query, skills = []) {
  const reserved=new Set(sessionCommands.map(item=>item.name));
  const agent=(Array.isArray(commands)?commands:[]).filter(item=>typeof item.name==='string'&&!reserved.has(item.name)).map(item=>({...item,source:'Agent 指令'}));
  return [...sessionCommands,...agent,...skills.filter(item=>!agent.some(command=>command.name===item.name)&&!reserved.has(item.name)).map(item=>({...item,source:'技能'}))]
    .filter(item=>(item.name+' '+(item.label??'')+' '+(item.description??'')).toLowerCase().includes(query.toLowerCase())).slice(0,100);
}
export function configCategory(option){
  const id=`${option.category??''} ${option.configId??''} ${option.name??''}`.toLowerCase();
  return /reason|effort|think|thought|思考|推理/.test(id)?'reasoning':/model/.test(id)?'model':'mode';
}

// Only an exact, argument-free workbench command is handled locally.
export function commandPanel(text, commands) {
  const match = /^\/([^\s]+)$/.exec(text.trim());
  if (!match) return null;
  if(commands?.some(item=>item.name===match[1]))return null;
  return localCommands.find(item => item.name === match[1])?.panel ?? null;
}

// Group messages have a text transport. Resolve references through the authorized
// workspace API and include bounded text rather than silently dropping paths.
export async function groupReferenceText(read,sessionId,text,files){
  if(!files.length)return text;
  const parts=await Promise.all(files.map(async path=>{
    const directory=path.endsWith('/');
    const result=await read(`/sessions/${encodeURIComponent(sessionId)}/${directory?'tree':'file'}?path=${encodeURIComponent(path)}`);
    if(result.binary)throw Error(`引用 ${path} 是二进制文件，请使用附件入口`);
    if(result.truncated)throw Error(`引用 ${path} 内容过大，请选择更小的文件`);
    const content=directory?(result.entries??[]).map(item=>item.path).join('\n'):result.text;
    if(typeof content!=='string')throw Error(`引用 ${path} 无法作为文本读取`);
    return `[引用${directory?'文件夹清单':'文件'}：${path}]\n${content}\n[引用结束]`;
  }));
  const prompt=text+'\n\n'+parts.join('\n\n');
  if(new TextEncoder().encode(prompt).length>12000)throw Error('会话组引用与消息超过大小限制，请减少引用内容');
  return prompt;
}
