import React,{useEffect,useRef} from 'react';
import {X} from 'lucide-react';
export function CompactDialog({title,close,children,busy=false,className=''}){
 const ref=useRef(null);
 useEffect(()=>{const node=ref.current;node.showModal();return()=>node.close();},[]);
 return <dialog ref={ref} className={`new-session-dialog space-editor ${className}`} aria-label={title} onCancel={e=>{e.preventDefault();if(!busy)close();}}><header><h1>{title}</h1><button className="icon-button" type="button" aria-label={`关闭${title}`} disabled={busy} onClick={close}><X size={17}/></button></header>{children}</dialog>;
}
