import React,{useMemo} from 'react';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import rust from 'highlight.js/lib/languages/rust';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import bash from 'highlight.js/lib/languages/bash';
import python from 'highlight.js/lib/languages/python';
for(const [name,grammar] of Object.entries({javascript,typescript,rust,json,css,xml,bash,python}))hljs.registerLanguage(name,grammar);
const languages={js:'javascript',jsx:'javascript',mjs:'javascript',cjs:'javascript',ts:'typescript',tsx:'typescript',rs:'rust',json:'json',css:'css',html:'xml',svg:'xml',xml:'xml',sh:'bash',bash:'bash',py:'python'};
// highlight.js escapes source text before emitting only its own token markup.
export function CodeText({text,path=''}){
 const language=languages[path.split('.').at(-1)?.toLowerCase()];
 const html=useMemo(()=>{if(!language||text.length>20000)return null;try{return hljs.highlight(text,{language,ignoreIllegals:true}).value;}catch{return null;}},[text,language]);
 return html==null?<code>{text}</code>:<code dangerouslySetInnerHTML={{__html:html}}/>;
}
