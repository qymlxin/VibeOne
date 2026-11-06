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
