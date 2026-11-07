export function parseToolValue(value) {
  if (typeof value !== 'string') return value;
  const text=value.trim();
  if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
    try { return JSON.parse(text); } catch { /* Streaming or ordinary text stays text. */ }
  }
  return value;
}

export function safeToolUrl(value) {
  if (typeof value !== 'string') return null;
  try { const url=new URL(value); return ['https:','http:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}
const record=value=>value && typeof value==='object' && !Array.isArray(value) ? value : {};
const strings=value=>(Array.isArray(value)?value:[value]).filter(value=>typeof value==='string' && value.trim());
const first=(...values)=>values.find(value=>value!==undefined && value!==null);

export function describeTool(tool) {
  const raw=parseToolValue(tool.rawInput), input=record(raw), action=record(input.action);
  const type=String(input.type ?? tool.name ?? tool.kind ?? '').toLowerCase();
  const operation=String(action.type ?? '').toLowerCase();
  let kind='generic', fields=[];
  const queries=[action.queries,input.queries,action.query,input.query].map(strings).find(values=>values.length) ?? [];
  const searchQueries=queries.length ? queries : (Array.isArray(input.search_query)?input.search_query.map(item=>item?.q).filter(value=>typeof value==='string'):[]);
  if (operation.includes('find')) {
    kind='web';fields=[{label:'网页地址',value:first(action.url,input.url),format:'links'},{label:'查找内容',value:first(action.pattern,input.pattern,action.query)}];
  } else if (operation==='openpage' || operation==='open' || (!searchQueries.length && first(action.url,input.url) && /web|fetch|open/.test(type))) {
    kind='web';fields=[{label:'网页地址',value:first(action.url,input.url,input.urls),format:'links'}];
  } else if (searchQueries.length || /search/.test(type) || operation==='search') {
    kind='search';fields=[{label:'搜索词',value:searchQueries.length?searchQueries:'Agent 尚未提供搜索词'}];
    if (input.domains) fields.push({label:'站点范围',value:input.domains});
  } else if (first(input.command,input.cmd,input.argv)!==undefined) {
    kind='command';fields=[{label:Array.isArray(first(input.command,input.cmd,input.argv))?'命令参数':'命令',value:first(input.command,input.cmd,input.argv),format:'code'}];
    if (first(input.cwd,input.workdir)!==undefined) fields.push({label:'工作目录',value:first(input.cwd,input.workdir),format:'code'});
  } else if (first(input.file_path,input.filePath,input.path)!==undefined || Array.isArray(input.changes)) {
    kind='file';
    if (first(input.file_path,input.filePath,input.path)!==undefined) fields.push({label:'文件',value:first(input.file_path,input.filePath,input.path),format:'code'});
    for (const [key,label] of [['offset','起始位置'],['limit','读取上限'],['old_string','替换前'],['new_string','替换后'],['diff','差异'],['content','写入内容'],['changes','文件变更']]) {
      if (input[key]!=null) fields.push({label,value:input[key],format:['diff','old_string','new_string','content'].includes(key)?'code':undefined});
    }
  } else if (raw!=null) fields=[{label:'参数',value:raw}];
  const outputs=[];
  const append=value=>{ if(value!=null && value!=='') outputs.push({type:'value',value:parseToolValue(value)}); };
  append(tool.output);append(tool.rawOutput);
  for (const block of Array.isArray(tool.content)?tool.content:[]) {
    if (block?.type==='diff') outputs.push({type:'diff',path:block.path??block.changes?.[0]?.path,oldText:block.oldText,newText:block.newText,patch:block.patch?.text});
    else if (block?.type==='content') {
      const content=block.content;
      if (content?.type==='text') append(content.text);
      else if (content?.type==='resource_link') outputs.push({type:'link',name:content.name ?? content.title,url:content.uri});
      else if (content?.type==='image') outputs.push({type:'notice',text:`图片内容（${content.mimeType ?? '未提供格式'}），原始数据可供查看。`});
      else if (content?.type==='resource' && content.resource?.text!=null) append(content.resource.text);
      else outputs.push({type:'notice',text:`Agent 返回了${content?.type ?? '未知'}内容，详见原始数据。`});
    } else if (block?.type==='terminal') outputs.push({type:'notice',text:'此工具关联终端，终端记录可在 Agent 设置中查看。'});
    else append(block);
  }
  const seen=new Set();
  return {kind,fields,outputs:outputs.filter(output=>{const key=JSON.stringify(output);if(seen.has(key))return false;seen.add(key);return true;})};
}

// Use explicit ACP semantics. Do not guess file reads by parsing shell commands.
export function describeAction(tool) {
  const input=record(parseToolValue(tool.rawInput));
  const paths=[...new Set([
    ...strings(first(input.file_path,input.filePath,input.path)),
    ...(Array.isArray(tool.locations)?tool.locations.map(location=>typeof location==='string'?location:location?.path):[]),
    ...(Array.isArray(tool.content)?tool.content.flatMap(block=>block?.type==='diff'?[block.path,...(block.changes??[]).map(change=>change.path)]:[]):[]),
  ].filter(path=>typeof path==='string' && path.trim()))];
  // Codex's read reporter can provide a title even when old projections omit locations.
  const titlePath=tool.kind==='read' ? /^Read file '(.+)'$/.exec(tool.title ?? '')?.[1] : null;
  if(!paths.length && titlePath)paths.push(titlePath);
  const operation=tool.kind==='read' && !/^List files/.test(tool.title ?? '')?'read':tool.kind==='edit'?'edit':null;
  const done=tool.status==='completed';
  return {paths,operation,label:operation==='read'?(done?'已读取':'读取文件'):operation==='edit'?(done?'已修改':'修改文件'):null};
}
