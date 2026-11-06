export function configChoices(option) {
  if(option.type!=='select'||!Array.isArray(option.options))return [];
  return option.options.flatMap(group=>{
    if(Array.isArray(group.options))return group.options.filter(item=>typeof item.value==='string').map(item=>({...item,group:group.name??group.groupId}));
    return typeof group.value==='string'?[group]:[];
  });
}
export function canConfigure(session,workbench) {
  return workbench.phase==='online'&&!session.historyOnly&&!session.archived&&!(session.queue?.length)&&!['starting','running','requires_action','cancelling','disconnected'].includes(session.status)&&(!workbench.device||workbench.device.role==='operator');
}
