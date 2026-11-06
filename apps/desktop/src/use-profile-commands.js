import {useRef} from 'react';

// Retain the command identity after an unknown outcome; never replay automatically.
export function useProfileCommands(workbench) {
  const intent=useRef(null);
  return {
    reset(){intent.current=null;},
    async call([path,body]) {
      if(!workbench.features?.includes('profileCommandIdempotency'))return workbench.call(path,body);
      const signature=JSON.stringify(body);
      if(intent.current?.signature!==signature)intent.current={signature,key:crypto.randomUUID()};
      const current=intent.current;
      const result=await workbench.call(path,{...body,key:current.key});
      if(intent.current===current)intent.current=null;
      return result;
    },
  };
}
