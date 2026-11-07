import {Appearance} from './approved/Appearance.jsx';
import React,{useEffect,useState} from 'react';
import {Sun,Moon,Monitor,Check} from 'lucide-react';
import {appearanceKey,baseColors,normalizeAppearance,readAppearance,applyAppearance,contrastRatio} from './appearance.js';
export function useAppearance(theme){
 const [value,setValue]=useState(readAppearance),[systemDark,setSystemDark]=useState(()=>matchMedia('(prefers-color-scheme: dark)').matches),[temporary,setTemporary]=useState(false);
 const dark=theme==='system'?systemDark:theme==='dark';
 useEffect(()=>{const media=matchMedia('(prefers-color-scheme: dark)');const update=()=>setSystemDark(media.matches);media.addEventListener('change',update);update();return()=>media.removeEventListener('change',update);},[]);
 useEffect(()=>applyAppearance(value,dark?'dark':'light'),[value,dark]);
 useEffect(()=>{try{localStorage.setItem(appearanceKey,JSON.stringify(value));}catch{setTemporary(true);}},[value]);
 const update=next=>setValue(previous=>normalizeAppearance(typeof next==='function'?next(previous):next));return {value,update,dark,temporary};
}
export function AppearanceSettings({theme,setTheme,appearance,onBack}){const {value,update,dark,temporary}=appearance,mode=dark?'dark':'light';return <><Appearance theme={theme} setTheme={setTheme} dark={dark} colors={{...(value[mode].background?{bg:value[mode].background}:{}),...(value[mode].foreground?{fg:value[mode].foreground}:{})}} accent={value.accent} setAccent={accent=>update(previous=>({...previous,accent}))} changeColor={(key,color)=>update(previous=>({...previous,[mode]:{...previous[mode],[key==='bg'?'background':'foreground']:color}}))} reset={()=>update(previous=>({...previous,accent:'#3564F5',[mode]:{}}))} onBack={onBack}/>{temporary&&<p role="status">当前浏览器无法保存，调整在本次页面中有效。</p>}</>;}
