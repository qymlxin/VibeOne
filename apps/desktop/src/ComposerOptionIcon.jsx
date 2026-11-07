import React from 'react';
import {Cpu,BrainCircuit,SlidersHorizontal,Command,BookOpen,Folder,FileText,Terminal,GitBranch,History,ListChecks,Cable,Activity,ScanEye,GitCompareArrows,GitCommitHorizontal,Shrink,MessageSquarePlus,FilePlus2,CircleHelp,ShieldCheck,Eraser,LogOut,Archive,Package,Users} from 'lucide-react';
import {SessionAvatar} from './SessionIdentity.jsx';
const icons={plan:ListChecks,mcp:Cable,skills:BookOpen,status:Activity,review:ScanEye,'review-branch':GitCompareArrows,'review-commit':GitCommitHorizontal,compact:Shrink,new:MessageSquarePlus,init:FilePlus2,help:CircleHelp,permissions:ShieldCheck,clear:Eraser,logout:LogOut,archive:Archive};
export function ComposerOptionIcon({item}){
 if(item.kind==='agent')return <span className="composer-option-icon avatar"><SessionAvatar color={item.color} shape={item.shape}/></span>;
 const Icon=item.control==='model'?Cpu:item.control==='reasoning'?BrainCircuit:item.control==='mode'?SlidersHorizontal:item.kind==='skill'?BookOpen:item.kind==='target'?Users:item.kind==='config'?SlidersHorizontal:({terminal:Terminal,changes:GitBranch,runs:History,files:Folder,artifacts:Package,agent:SlidersHorizontal})[item.panel]??icons[item.name]??(item.kind==='directory'?Folder:item.kind==='file'?FileText:Command);
 return <span className={`composer-option-icon ${item.kind==='skill'?'skill':''}`}><Icon size={16} strokeWidth={1.65} aria-hidden="true"/></span>;
}
