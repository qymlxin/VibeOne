// Detect only the token at the caret; text after the caret is preserved.
export function composerToken(text, caret) {
  const prefix = text.slice(0, caret);
  const quoted=/(?:^|\s)@"([^"\n]*)$/.exec(prefix);
  if(quoted)return {kind:'@',query:quoted[1],start:prefix.length-quoted[1].length-2,end:caret};
  const match = /(?:^|\s)([@/])([^\s]*)$/.exec(prefix);
  if (!match) return null;
  return {kind:match[1], query:match[2], start:prefix.length-match[2].length-1, end:caret};
}
export function replaceToken(text, token, value) {
  return text.slice(0,token.start)+value+text.slice(token.end);
}
export const localCommands = [
  {name:'files',description:'打开工作区文件',panel:'files'},
  {name:'changes',description:'查看工作区变更',panel:'changes'},
  {name:'terminal',description:'查看终端执行记录',panel:'terminal'},
  {name:'runs',description:'查看执行记录',panel:'runs'},
];
export function commandOptions(commands, query) {
  const agent = (Array.isArray(commands)?commands:[]).filter(item=>typeof item.name==='string').map(item=>({...item,source:'Agent'}));
  const names=new Set(agent.map(item=>item.name));
  return [...agent,...localCommands.filter(item=>!names.has(item.name)).map(item=>({...item,source:'工作台'}))]
    .filter(item=>(item.name+' '+(item.description??'')).toLowerCase().includes(query.toLowerCase())).slice(0,50);
}

// Only an exact, argument-free workbench command is handled locally.
export function commandPanel(text, commands) {
  const match = /^\/([^\s]+)$/.exec(text.trim());
  if (!match) return null;
  return commandOptions(commands, '').find(item => item.name === match[1])?.panel ?? null;
}
