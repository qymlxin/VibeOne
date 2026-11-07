import React,{useEffect,useRef} from 'react';
import {Plus,Users,FolderPlus} from 'lucide-react';
export function CreationMenu({onAgent,onProject,children}){
 const ref=useRef(null);
 useEffect(()=>{const outside=e=>{if(!ref.current?.contains(e.target))ref.current.open=false;};const key=e=>{if(e.key==='Escape'&&ref.current?.open){ref.current.open=false;ref.current.querySelector('summary')?.focus();}};document.addEventListener('pointerdown',outside);document.addEventListener('keydown',key);return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key);};},[]);
 const select=action=>{ref.current.open=false;action();};
 return <details ref={ref} className="workbench-tool-menu creation-menu"><summary className="icon-button" aria-label="新建" title="新建"><Plus size={17}/></summary><div><button type="button" onClick={()=>select(onAgent)}><Users size={14}/>创建 Agent</button><button type="button" onClick={()=>select(onProject)}><FolderPlus size={14}/>创建项目</button>{children}</div></details>;
}
