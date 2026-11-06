import type {CreateSessionRequest,SubmitMessageRequest,QueueRequest,SubmitMessageReceipt,HttpErrorResponse} from '../src/generated.js';
const create:CreateSessionRequest={provider:'codex'};
const submit:SubmitMessageRequest={text:'task'};
const queue:QueueRequest={freshContext:true};
const receipt:SubmitMessageReceipt={operationId:'run',queued:false,duplicate:false};
const error:HttpErrorResponse={code:'CONFLICT',error:'说明',requestId:'id',status:409};
// @ts-expect-error provider is mandatory
const missing:CreateSessionRequest={workspace:'/project'};
// @ts-expect-error arrays cannot be replaced by a string
const wrongFiles:SubmitMessageRequest={text:'task',files:'one.txt'};
// @ts-expect-error null must not replace a default non-null string
const wrongWorkspace:CreateSessionRequest={provider:'codex',workspace:null};
// @ts-expect-error wire fields use camelCase
const wrongQueue:QueueRequest={fresh_context:true};
// @ts-expect-error a receipt cannot silently omit durable identity
const wrongReceipt:SubmitMessageReceipt={queued:false,duplicate:false};
void [create,submit,queue,receipt,error,missing,wrongFiles,wrongWorkspace,wrongQueue,wrongReceipt];

import type {ProfileRequest,ProfileRecord,ProfileResponse} from '../src/generated.js';
import {saveProfile,removeProfile} from '../src/index.js';
const profile:ProfileRecord={id:'profile',revision:1,name:'demo',provider:'demo'};
const profileResponse:ProfileResponse=profile;
saveProfile({name:'demo',provider:'demo',args:['one']});removeProfile('profile',1);
// @ts-expect-error explicit null must not disable revision checking
const nullRevision:ProfileRequest={revision:null};
// @ts-expect-error args must contain only strings
const wrongArgs:ProfileRequest={args:[1]};
// @ts-expect-error saved records require a durable revision
const missingRevision:ProfileRecord={id:'profile',name:'demo',provider:'demo'};
// @ts-expect-error saves require provider and name even though remove requests do not
saveProfile({id:'profile'});
void [profileResponse,nullRevision,wrongArgs,missingRevision];

import type {RunRecord,SessionView} from '../src/generated.js';
const legacyRun:RunRecord={id:'run',status:'completed',futureField:{keep:true}};
const sessionView:SessionView={id:'session',title:'New',workspace:'/project',provider:'demo',status:'idle',messages:[],tools:[],approvals:[],runs:[legacyRun],queue:[]};
// @ts-expect-error run identity must be a string
const invalidRun:RunRecord={id:1,status:'queued'};
// @ts-expect-error file references cannot contain numeric paths
const invalidRunFiles:RunRecord={id:'run',status:'queued',files:[1]};
// @ts-expect-error the queue must contain typed run records
const invalidSession:SessionView={...sessionView,queue:['run']};
void [legacyRun,sessionView,invalidRun,invalidRunFiles,invalidSession];

import type {SnapshotResponse,PendingRequest,DecisionRecord,Provider} from '../src/generated.js';
const pendingRequest:PendingRequest={id:'request',runId:'run',options:[{optionId:'allow',name:'Allow',kind:'allow_once'}],toolCall:{title:'Read'}};
const inputDecision:DecisionRecord={id:'decision',requestId:'request',delivery:'pending',answer:{action:'accept',content:{enabled:false,count:0}}};
// @ts-expect-error approval option IDs are protocol strings
const badOption:PendingRequest={id:'request',options:[{optionId:1,name:'Allow',kind:'allow_once'}]};
// @ts-expect-error request expiry is numeric, never a display string
const badExpiry:PendingRequest={id:'request',expiresAt:'tomorrow'};
// @ts-expect-error private launch commands are absent from public Provider descriptors
const privateProvider:Provider={id:'demo',name:'Demo',available:true,description:'Demo',command:'/private/agent'};
// @ts-expect-error typed snapshots cannot replace session records with IDs
const badSnapshotSessions:SnapshotResponse['sessions']=['session'];
void [pendingRequest,inputDecision,badOption,badExpiry,privateProvider,badSnapshotSessions];

import type {ProfileView,PinnedProfile,ProfileIssue} from '../src/generated.js';
const legacyProfile:ProfileView={id:'legacy',name:'Legacy',provider:'demo',future:{keep:true}};
const pluginPinned:PinnedProfile={name:'Plugin',provider:'plugin:demo',pluginId:'plugin',generation:1,command:'/agent',args:[]};
const profileIssue:ProfileIssue={id:'bad',error:'Invalid record',recordHash:'hash'};
removeProfile('bad',undefined,profileIssue.recordHash);
// @ts-expect-error catalog entries have a persistent identity even when legacy revision is absent
const noProfileId:ProfileView={name:'Legacy',provider:'demo'};
// @ts-expect-error launch arguments remain strings in catalog and pinned views
const badPinnedArgs:PinnedProfile={args:[1]};
// @ts-expect-error record identity guards are strings
const badProfileHash:ProfileRequest={id:'bad',recordHash:1,remove:true};
void [legacyProfile,pluginPinned,profileIssue,noProfileId,badPinnedArgs,badProfileHash];
