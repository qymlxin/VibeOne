// Runtime address wins for the visible IP; saved port 0 remains an explicit intent.
// URL fallback keeps older Hosts, which do not publish configuration, usable.
export function remotePreferences(state) {
  const configuration=state?.configuration;
  let address;
  try { if(state?.url) address=new URL(state.url); } catch { /* Fall back to confirmed configuration. */ }
  const savedPort=configuration?.port;
  return {
    ip:address?.hostname.replace(/^\[|\]$/g,'') || configuration?.ip || state?.suggestedIp || '',
    port:String(Number.isInteger(savedPort)&&savedPort>=0&&savedPort<=65535?savedPort:address?.port||0),
  };
}

const roles={viewer:'仅查看',approver:'查看与审批',operator:'查看、操作与审批'};
const statuses={active:'已授权',expired:'已过期',revoked:'已撤销',invalid:'记录异常'};
export function devicePresentation(device,workspaces=[],timestamp=Date.now()/1000){
  const id=typeof device.id==='string'&&device.id.length?device.id:null;
  const knownRole=Object.hasOwn(roles,device.role)?roles[device.role]:null;
  const validScopes=Array.isArray(device.workspaces)&&device.workspaces.length>0&&device.workspaces.every(id=>typeof id==='string'&&id.length>0);
  const scopes=Array.isArray(device.workspaces)?device.workspaces.filter(id=>typeof id==='string'&&id.length>0):[];
  // Current Host status is authoritative, including when client clocks differ.
  const status=Object.hasOwn(statuses,device.status)?device.status:device.revoked===true?'revoked':!id||!knownRole||!validScopes||device.revoked!==false||!Number.isFinite(device.expiresAt)?'invalid':device.expiresAt<=timestamp?'expired':'active';
  const date=typeof device.expiresAt==='number'?new Date(device.expiresAt*1000):null;
  return {id,name:typeof device.name==='string'&&device.name?device.name:'未命名设备',status,label:statuses[status],role:knownRole??'未知角色',expires:date&&!Number.isNaN(date.getTime())?date.toLocaleString():null,scopes:scopes.map(id=>workspaces.find(workspace=>workspace.id===id)?.name??`未找到的工作区（${id}）`)};
}
