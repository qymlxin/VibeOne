export function sessionGroups(sessions,workspaces=[]) {
 const names=new Map(workspaces.map(workspace=>[workspace.path,workspace.name]));
 const groups=new Map();
 for(const session of sessions){
  if(!groups.has(session.workspace))groups.set(session.workspace,{path:session.workspace,name:names.get(session.workspace)||session.workspace.split(/[\\/]/).filter(Boolean).at(-1)||'工作区',sessions:[]});
  groups.get(session.workspace).sessions.push(session);
 }
 return [...groups.values()];
}

export function recentSessions(sessions) {
 const activity=session=>Math.max(session.lastActivityAt??0,...(session.runs??[]).map(run=>Math.max(run.createdAt??0,run.finishedAt??0)));
 return [...sessions].sort((a,b)=>activity(b)-activity(a)||a.id.localeCompare(b.id));
}
