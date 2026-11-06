import {useRef} from 'react';
import {cancelSession} from '@vibeone/client-contracts';

export const activeRunForStop=session=>session.runs?.findLast(run=>run.finishedAt==null&&['starting','running','requires_action','cancelling'].includes(run.status));

export function useStopCommand(workbench,session) {
  const intent=useRef(null);
  return async()=>{
    if(!workbench.features?.includes('stopCommandIdempotency'))return workbench.call(...cancelSession(session.id));
    const run=activeRunForStop(session);
    if(!run)throw Error('当前执行身份尚未同步，请稍后重试。');
    if(intent.current?.runId!==run.id)intent.current={runId:run.id,key:crypto.randomUUID()};
    // Keep this identity for the lifetime of the Run, including after acceptance.
    return workbench.call(...cancelSession(session.id,intent.current.key,run.id));
  };
}
