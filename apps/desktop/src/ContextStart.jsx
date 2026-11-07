import {useWorkspaceExtensions} from './workspace-extensions.jsx';
import React from 'react';
import {GitBranch,Terminal,Folder,ArrowUpRight} from 'lucide-react';
export function ContextStart({onChoose}){const {tools}=useWorkspaceExtensions();const icons={changes:GitBranch,terminal:Terminal,folder:Folder,browser:ArrowUpRight};return <section className="context-start"><h2>工具</h2><div>{tools.filter(tool=>tool.id!=='browser').map(tool=>{const Icon=icons[tool.icon]??Folder;return <button key={tool.id} onClick={()=>onChoose(tool.id)}><span className="context-start-icon"><Icon size={20}/></span><span><strong>{tool.title}</strong><small>{tool.description}</small></span><ArrowUpRight size={16}/></button>;})}</div></section>;}
