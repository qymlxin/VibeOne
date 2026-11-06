import React,{useRef} from 'react';
export function SplitHandle({onResize}){
 const drag=useRef(null);
 const resize=(node,width)=>onResize(Math.round(Math.max(320,Math.min(node.parentElement.clientWidth-360,width))));
 return <div className="desktop-split-handle" role="separator" aria-label="调整右侧预览宽度" aria-orientation="vertical" tabIndex={0} onKeyDown={event=>{if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();resize(event.currentTarget,event.currentTarget.nextElementSibling.clientWidth+(event.key==='ArrowLeft'?24:-24));}}} onPointerDown={event=>{if(event.button!==0)return;event.currentTarget.setPointerCapture(event.pointerId);drag.current={x:event.clientX,width:event.currentTarget.nextElementSibling.clientWidth};}} onPointerMove={event=>{if(drag.current)resize(event.currentTarget,drag.current.width+drag.current.x-event.clientX);}} onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}} onLostPointerCapture={()=>{drag.current=null;}}/>;
}
