export function previewUrl(value){
 if(typeof value!=='string')return null;
 try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;}
}
export function workspacePath(value,workspace){
 if(typeof value!=='string'||!value.trim()||value.includes('\0'))return null;
 let path=value.trim();
 try{if(path.startsWith('file:')){const url=new URL(path);if(url.hostname && url.hostname!=='localhost')return null;path=decodeURIComponent(url.pathname);}else path=decodeURIComponent(path.split('#')[0].split('?')[0]);}catch{return null;}
 if(/^[a-z][a-z\d+.-]*:/i.test(path))return null;
 const root=String(workspace??'').replace(/\/$/,'');
 if(path.startsWith('/')){if(!root||!path.startsWith(`${root}/`))return null;path=path.slice(root.length+1);}
 if(path.includes('\\')||path.split('/').some(part=>part==='..'))return null;
 path=path.replace(/^\.\//,'');return path && path!=='.'?path:null;
}
