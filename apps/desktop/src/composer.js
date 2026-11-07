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
export function commandOptions(commands, query, skills = []) {
  const agent = (Array.isArray(commands)?commands:[]).filter(item=>typeof item.name==='string').map(item=>({...item,source:'Agent'}));
  const names=new Set(agent.map(item=>item.name));
  return [...agent,...localCommands.filter(item=>!names.has(item.name)).map(item=>({...item,source:'工作台'})),...skills.filter(item=>!names.has(item.name)&&!localCommands.some(command=>command.name===item.name))]
    .filter(item=>(item.name+' '+(item.label??'')+' '+(item.description??'')).toLowerCase().includes(query.toLowerCase())).slice(0,50);
}

// Only an exact, argument-free workbench command is handled locally.
export function commandPanel(text, commands) {
  const match = /^\/([^\s]+)$/.exec(text.trim());
  if (!match) return null;
  return commandOptions(commands, '').find(item => item.name === match[1])?.panel ?? null;
}
