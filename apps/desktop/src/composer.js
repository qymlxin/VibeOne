// Query by the caret prefix, replace the complete token, preserve surrounding prose.
export function composerToken(text, caret) {
  const prefix = text.slice(0, caret);
  const suffix = text.slice(caret);
  const quoted=/(?:^|\s)@"([^"\n]*)$/.exec(prefix);
  if(quoted)return {kind:'@',query:quoted[1],start:prefix.length-quoted[1].length-2,end:caret+(suffix.match(/^[^"\n]*(?:")?/)?.[0].length??0)};
  const match = /(?:^|\s)([@/])([^\s]*)$/.exec(prefix);
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
  {name:'files',description:'打开工作区文件',panel:'files'},
  {name:'changes',description:'查看工作区变更',panel:'changes'},
  {name:'terminal',description:'查看终端执行记录',panel:'terminal'},
  {name:'runs',description:'查看执行记录',panel:'runs'},
];
export function commandOptions(commands, query, skills = []) {
  const agent = (Array.isArray(commands)?commands:[]).filter(item=>typeof item.name==='string').map(item=>({...item,source:'Agent'}));
  const names=new Set(agent.map(item=>item.name));
  return [...agent,...localCommands.filter(item=>!names.has(item.name)).map(item=>({...item,source:'工作台'})),...skills.filter(item=>!names.has(item.name)&&!localCommands.some(command=>command.name===item.name))]
    .filter(item=>(item.name+' '+(item.description??'')).toLowerCase().includes(query.toLowerCase())).slice(0,50);
}

// Only an exact, argument-free workbench command is handled locally.
export function commandPanel(text, commands) {
  const match = /^\/([^\s]+)$/.exec(text.trim());
  if (!match) return null;
  return commandOptions(commands, '').find(item => item.name === match[1])?.panel ?? null;
}
