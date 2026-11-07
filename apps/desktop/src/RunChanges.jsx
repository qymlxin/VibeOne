import React from 'react';
import './run-changes.css';
import {GitCompareArrows} from 'lucide-react';
import {PierreDiff} from './PierreCode.jsx';
export function RunChanges({snapshot}) {
 return <section className="run-change-preview"><header><GitCompareArrows size={15}/><strong>本轮变更</strong><span>{snapshot.files.length} 个文件 <em>+{snapshot.added}</em> <b>−{snapshot.removed}</b></span></header><p>{snapshot.notice}</p><div>{snapshot.files.map(file=><article key={file.path}>{file.previewAvailable?<PierreDiff path={file.path} oldText={file.oldText} newText={file.newText}/>:<><h3>{file.path}</h3><p>{file.binary?'二进制文件已变化，无法显示文本差异。':'文件超过快照预览上限，仅保留变更信息。'}</p></>}</article>)}</div></section>;
}
export function WorkspaceChangeOverview({summary,onOpen}) {
 return <button className="workspace-change-overview" onClick={onOpen} title="查看相对 Git 基线的当前整体变更"><GitCompareArrows size={16}/><span><strong>工作区整体变更</strong><small>{summary?.error?'读取失败，点击打开变更重试':summary?summary.isGit?`${summary.files.length} 个文件`:'当前目录未启用 Git':'正在读取工作区状态'}</small></span>{summary?.isGit&&summary.statsAvailable&&<span className="change-totals"><em>+{summary.added}</em><b>−{summary.removed}</b></span>}</button>;
}
