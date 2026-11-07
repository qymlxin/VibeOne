import {useRef,useState} from 'react';
import {updateSession} from '@vibeone/client-contracts';

export function useMetadataCommands(workbench,sessionId) {
  const intent=useRef(null),pending=useRef(false);
  const [busy,setBusy]=useState(false),[failure,setFailure]=useState(null);
  const execute=async body=>{
    if(pending.current)return false;
    const signature=JSON.stringify(body);
    if(intent.current&&intent.current.signature!==signature)return false;
    if(!intent.current)intent.current={signature,body,key:crypto.randomUUID()};
    const current=intent.current;pending.current=true;setBusy(true);setFailure(null);
    try {
      await workbench.call(...updateSession(sessionId,{...current.body,...(workbench.features?.includes('metadataCommandIdempotency')?{key:current.key}:{})}));
      intent.current=null;return true;
    }catch(error){setFailure({body:current.body,message:error instanceof TypeError?'连接失败，会话修改结果尚未确认。':error.message??String(error)});return false;}
    finally{pending.current=false;setBusy(false);}
  };
  return {execute,busy,failure,retry:()=>failure?execute(failure.body):Promise.resolve(false),dismiss:()=>{if(pending.current)return;intent.current=null;setFailure(null);}};
}
