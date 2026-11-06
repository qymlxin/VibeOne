export type * from './generated.js';
import type {CreateSessionRequest,SubmitMessageRequest,QueueRequest,UpdateSessionRequest,WorkspaceImportRequest,ApprovalDecisionRequest,ProfileRequest} from './generated.js';
export type Command<T> = readonly [path:string,body:T];
export function createSession(provider:string,workspace='',profileId?:string,key?:string):Command<CreateSessionRequest>{
 return ['/sessions',{provider,workspace,...(profileId?{profileId}:{}),...(key?{key}:{})}];
}
export function submitMessage(sessionId:string,text:string,files:string[],attachments:string[],key:string):Command<SubmitMessageRequest>{
 return [`/sessions/${encodeURIComponent(sessionId)}/messages`,{text,files,attachments,key}];
}
export function controlQueue(sessionId:string,body:QueueRequest):Command<QueueRequest>{return [`/sessions/${encodeURIComponent(sessionId)}/queue`,body];}
export function updateSession(sessionId:string,body:UpdateSessionRequest):Command<UpdateSessionRequest>{return [`/sessions/${encodeURIComponent(sessionId)}/metadata`,body];}
export function importWorkspace(path:string):Command<WorkspaceImportRequest>{return ['/workspaces',{path}];}
export function decideApproval(sessionId:string,requestId:string,option:string):Command<ApprovalDecisionRequest>{return [`/sessions/${encodeURIComponent(sessionId)}/approvals/${encodeURIComponent(requestId)}`,{option}];}

export function saveProfile(body:Omit<ProfileRequest,'remove'> & Required<Pick<ProfileRequest,'name'|'provider'>>):Command<ProfileRequest>{return ['/profiles',body];}
export function removeProfile(id:string,revision?:number,recordHash?:string,key?:string):Command<ProfileRequest>{return ['/profiles',{id,...(revision===undefined?{}:{revision}),...(recordHash===undefined?{}:{recordHash}),...(key===undefined?{}:{key}),remove:true}];}

export function probeProvider(provider:string,profileId?:string):Command<import('./generated.js').ProviderProbeRequest>{return [`/providers/${encodeURIComponent(provider)}/probe`,{...(profileId?{profileId}:{})}];}

export function pluginLifecycleOperation(action:import('./generated.js').PluginLifecycleAction,input:import('./generated.js').JsonValue,key:string):Command<import('./generated.js').PluginLifecycleRequest>{return ['/plugin-lifecycle/operations',{action,input,key}];}
