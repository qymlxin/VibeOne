import React from 'react';
import {GitBranch,Terminal,Folder,ArrowUpRight} from 'lucide-react';
export function ContextStart({onChoose}){return <section className="context-start"><h2>工具</h2><div>{[['changes','变更','检查工作区文件差异',GitBranch],['terminal','终端','运行命令与脚本',Terminal],['files','文件','浏览目录与预览代码',Folder]].map(([id,name,description,Icon])=><button key={id} onClick={()=>onChoose(id)}><span className="context-start-icon"><Icon size={20}/></span><span><strong>{name}</strong><small>{description}</small></span><ArrowUpRight size={16}/></button>)}</div></section>;}
