export function paneDrag(raw,minimum,maximum){
 const min=Math.min(minimum,maximum),width=Math.max(0,Math.min(maximum,raw));
 return {collapsed:width<=min/2,width:width<=min/2?0:width,opacity:min?Math.max(0,Math.min(1,(width-min/2)/(min/2))):0};
}
export function paneRelease(raw,minimum,maximum){
 const state=paneDrag(raw,minimum,maximum);
 return {...state,width:state.collapsed?0:Math.max(Math.min(minimum,maximum),state.width),opacity:state.collapsed?0:1};
}
