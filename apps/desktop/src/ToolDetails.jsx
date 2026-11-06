import React, {useState} from 'react';
import {describeAction,describeTool,safeToolUrl} from './tool-presentation.js';

const labels={query:'搜索词',queries:'搜索词',url:'网页',title:'标题',snippet:'摘要',description:'说明',path:'路径',file_path:'文件',kind:'变更类型',command:'命令',cwd:'工作目录',stdout:'标准输出',stderr:'错误输出',exit_code:'退出码',exitCode:'退出码',result:'结果',results:'结果',status:'状态',output:'输出',content:'内容',step:'步骤',demo:'演示'};
function LinkValue({value,name}) {
  const url=safeToolUrl(value);
  return url ? <a href={url} target="_blank" rel="noopener noreferrer">{name ?? value}</a> : <span>{name ? `${name}：` : ''}{String(value ?? '未提供')}</span>;
}
function Value({value,depth=0}) {
  if (value==null) return <span className="desktop-tool-muted">未提供</span>;
  if (typeof value==='boolean') return <span>{value?'是':'否'}</span>;
  if (typeof value==='string') return safeToolUrl(value)?<LinkValue value={value}/>:<span className="desktop-tool-text">{value || '（空）'}</span>;
  if (typeof value==='number') return <span>{value}</span>;
  if (depth>=4) return <span className="desktop-tool-muted">嵌套详情见原始数据</span>;
  if (Array.isArray(value)) return value.length ? <><ul>{value.slice(0,40).map((item,index)=><li key={index}><Value value={item} depth={depth+1}/></li>)}</ul>{value.length>40 && <p>还有 {value.length-40} 项，见原始数据。</p>}</> : <span>无</span>;
  const entries=Object.entries(value);
  return entries.length ? <><dl className="desktop-tool-fields">{entries.slice(0,30).map(([key,item])=><React.Fragment key={key}><dt>{Object.hasOwn(labels,key)?labels[key]:key}</dt><dd><Value value={item} depth={depth+1}/></dd></React.Fragment>)}</dl>{entries.length>30 && <p>更多字段见原始数据。</p>}</> : <span>无</span>;
}
function Output({output}) {
  if (output.type==='diff') return <div className="desktop-tool-diff">{output.path && <p><strong>文件</strong> <code>{output.path}</code></p>}{output.oldText!=null && <><h5>修改前</h5><pre>{output.oldText}</pre></>}{output.newText!=null && <><h5>修改后</h5><pre>{output.newText}</pre></>}</div>;
  if (output.type==='link') return <LinkValue value={output.url} name={output.name}/>;
  if (output.type==='notice') return <p className="desktop-tool-muted">{output.text}</p>;
  if (typeof output.value==='string') return <pre className="desktop-tool-output">{output.value}</pre>;
  return <Value value={output.value}/>;
}
export function ToolDetails({tool}) {
  const [rawOpen,setRawOpen]=useState(false);
  const {kind,fields,outputs}=describeTool(tool);
  const action=describeAction(tool);
  return <div className={`desktop-tool-detail ${kind}`}>
    {action.paths.length>0 && <section className="desktop-tool-files"><h4>{action.label ?? '关联文件'}</h4>{action.paths.map(path=><div key={path}><strong>{path.split(/[\\/]/).at(-1)}</strong><code>{path}</code></div>)}</section>}
    {fields.length>0 && <section><h4>{kind==='command'?'Shell':'输入'}</h4><dl className="desktop-tool-fields">{fields.map(field=><React.Fragment key={field.label}><dt>{field.label}</dt><dd>{field.format==='code' && typeof field.value==='string' ? <pre>{field.value}</pre> : <Value value={field.value}/>}</dd></React.Fragment>)}</dl></section>}
    {outputs.length>0 && <section><h4>输出</h4>{outputs.map((output,index)=><Output key={index} output={output}/>)}</section>}
    {kind==='command' && <p className="desktop-tool-result">{({completed:'执行完成',failed:'执行失败',cancelled:'已停止',in_progress:'执行中',pending:'等待执行'})[tool.status] ?? '状态未知'}</p>}
    {!fields.length && !outputs.length && !action.paths.length && <p className="desktop-tool-muted">Agent 尚未返回工具详情。</p>}
    <details className="desktop-tool-raw" onToggle={event=>setRawOpen(event.currentTarget.open)}><summary>查看原始数据</summary>{rawOpen && <pre>{JSON.stringify({input:tool.rawInput,content:tool.content,output:tool.output,rawOutput:tool.rawOutput},null,2)}</pre>}</details>
  </div>;
}
