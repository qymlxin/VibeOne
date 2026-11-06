import React,{createContext,useContext} from 'react';
import {previewUrl,workspacePath} from './preview-links.js';
export const PreviewContext=createContext(null);
export function PreviewLink({href,children,...props}){
 const preview=useContext(PreviewContext);const url=previewUrl(href),path=workspacePath(href,preview?.workspace);
 if(!url && !(preview && path))return <span>{children}</span>;
 return <a {...props} href={url ?? '#'} target={url?'_blank':undefined} rel="noopener noreferrer" onClick={event=>{
  if(!preview)return;
  if(url&&(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey))return;
  event.preventDefault();if(url)preview.openUrl(url);else preview.openFile(path);
 }}>{children}</a>;
}
export function FilePreviewLink({path,children}){const preview=useContext(PreviewContext),relative=workspacePath(path,preview?.workspace);return preview&&relative?<button className="desktop-file-link" onClick={()=>preview.openFile(relative)} title={path}>{children ?? path}</button>:<code>{children ?? path}</code>;}
export function markdownLink(value){return previewUrl(value) ?? (typeof value==='string' && !/^(?:javascript|data|vbscript):/i.test(value)?value:'');}
