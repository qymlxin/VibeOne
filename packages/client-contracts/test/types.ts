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
