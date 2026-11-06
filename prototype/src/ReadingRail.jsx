import React,{useEffect,useRef,useState} from 'react';
export function ReadingRail({entries,onJump}){
 const [active,setActive]=useState(entries.at(-1)?.id),[hovered,setHovered]=useState(null);const rootRef=useRef(null);
 const ids=entries.map(entry=>entry.id).join('|');
 useEffect(()=>{
  const scroll=document.querySelector('.chat-scroll');if(!scroll)return;let frame=0;
  const update=()=>{frame=0;const top=scroll.getBoundingClientRect().top+60;const nodes=[...scroll.querySelectorAll('.conversation-round')];const current=scroll.scrollHeight-scroll.scrollTop-scroll.clientHeight<3?nodes.at(-1):nodes.findLast(node=>node.getBoundingClientRect().top<=top) ?? nodes[0];setActive(current?.id);};
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(update);};const observer=new ResizeObserver(schedule);observer.observe(scroll);scroll.querySelectorAll('.conversation-round').forEach(node=>observer.observe(node));scroll.addEventListener('scroll',schedule,{passive:true});schedule();
  return ()=>{cancelAnimationFrame(frame);observer.disconnect();scroll.removeEventListener('scroll',schedule);};
 },[ids]);
 const preview=hovered===null?null:entries[hovered];
 return <nav className="reading-rail" aria-label="对话位置" ref={rootRef} onMouseLeave={()=>setHovered(null)} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setHovered(null);}}><div className="reading-marks">{entries.map((entry,index)=><button key={entry.id} aria-label={`跳转到第 ${index+1} 轮：${entry.title}`} aria-current={active===entry.id?'location':undefined} aria-describedby={hovered===index?'reading-preview':undefined} onMouseEnter={()=>setHovered(index)} onFocus={()=>setHovered(index)} onKeyDown={e=>{if(e.key==='Escape')setHovered(null);const next=({ArrowDown:Math.min(entries.length-1,index+1),ArrowUp:Math.max(0,index-1),Home:0,End:entries.length-1})[e.key];if(next!==undefined){e.preventDefault();e.currentTarget.parentElement.children[next].focus();}}} onClick={()=>onJump(entry.id)}><span style={{width:hovered===null?8:Math.max(8,38-Math.abs(index-hovered)*7)}}/></button>)}</div>{preview && <div className="reading-preview" id="reading-preview" role="tooltip" style={{top:`${Math.min(85,Math.max(15,(hovered+.5)/entries.length*100))}%`}}><strong>{preview.title}</strong><p>{preview.answer}</p></div>}</nav>;
}
