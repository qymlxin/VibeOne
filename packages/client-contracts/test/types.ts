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

import {probeProvider} from '../src/index.js';
probeProvider('demo');probeProvider('codex','saved-profile');
// @ts-expect-error profile identity is a string
probeProvider('demo',42);

import type {PluginOperationReceipt,PluginOperationSummary,PluginOperationRecord} from '../src/generated.js';
const operationReceipt:PluginOperationReceipt={operationId:'operation',state:'accepted'};
const legacyOperation:PluginOperationSummary={id:'operation',state:'future'};
const nullOperation:PluginOperationRecord={id:'operation',state:'succeeded',result:null};
const falseOperation:PluginOperationRecord={id:'operation',state:'succeeded',result:false};
// @ts-expect-error a receipt always carries its persistent operation identity
const noOperationIdentity:PluginOperationReceipt={state:'accepted'};
// @ts-expect-error timestamps use milliseconds as numbers
const badOperationTime:PluginOperationSummary={id:'operation',state:'running',createdAt:'now'};
// @ts-expect-error result bodies are only available from operation details
const resultInSummary:PluginOperationSummary={id:'operation',state:'succeeded',result:false};
// @ts-expect-error storage fingerprints never belong to public operation details
const privateOperationField:PluginOperationRecord={id:'operation',state:'succeeded',fingerprint:'private'};
void [operationReceipt,legacyOperation,nullOperation,falseOperation,noOperationIdentity,badOperationTime,resultInSummary,privateOperationField];

import {pluginLifecycleOperation} from '../src/index.js';
pluginLifecycleOperation('prepare',{path:'/plugin',trusted:true},'key');
// @ts-expect-error lifecycle actions are explicit supported protocol names
pluginLifecycleOperation('publish-everything',{},'key');
// @ts-expect-error durable operations always require a string idempotency identity
pluginLifecycleOperation('inspect',{path:'/plugin'},42);

import {configureAgent} from '../src/index.js';
import type {ConfigureAgentRequest,SessionUpdateResponse,DecisionSubmittedResponse,ResumeContextResponse} from '../src/generated.js';
configureAgent('session / id','mode','safe');configureAgent('session','future',{enabled:true,items:[1,null]});
const legacyConfig:ConfigureAgentRequest={id:'mode'};
const configuredResponse:SessionUpdateResponse={updated:true};
const submittedResponse:DecisionSubmittedResponse={submitted:true};
const resumedResponse:ResumeContextResponse={resumeOnNextRun:true};
// @ts-expect-error configuration identity is a string
configureAgent('session',42,'safe');
// @ts-expect-error undefined cannot be sent as a JSON value
configureAgent('session','mode',undefined);
// @ts-expect-error response fields retain camelCase
const badResume:ResumeContextResponse={resume_on_next_run:true};
// @ts-expect-error the receipt requires a boolean, not a display string
const badUpdate:SessionUpdateResponse={updated:'true'};
void [legacyConfig,configuredResponse,submittedResponse,resumedResponse,badResume,badUpdate];
