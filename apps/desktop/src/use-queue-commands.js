import {useRef,useState} from 'react';
import {controlQueue} from '@vibeone/client-contracts';

export function useQueueCommands(workbench,sessionId) {
  const intent=useRef(null),pending=useRef(false);
  const [busy,setBusy]=useState(false),[failure,setFailure]=useState(null);
  const execute=async body=>{
    if(pending.current)return false;
    const signature=JSON.stringify(body);
    if(intent.current?.signature!==signature)intent.current={signature,body,key:crypto.randomUUID()};
    const current=intent.current;
    pending.current=true;setBusy(true);setFailure(null);
    try {
      await workbench.call(...controlQueue(sessionId,{...body,...(workbench.features?.includes('queueCommandIdempotency')?{key:current.key}:{})}));
      intent.current=null;return true;
    }catch(error){setFailure({body:current.body,message:error instanceof TypeError?'连接失败，队列操作结果尚未确认。':error.message??String(error)});return false;}
    finally{pending.current=false;setBusy(false);}
  };
  return {execute,busy,failure,retry:()=>failure?execute(failure.body):Promise.resolve(false),dismiss:()=>{intent.current=null;setFailure(null);}};
}
