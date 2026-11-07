import React from 'react';
import {Folder,Globe,GitBranch,Terminal,Blocks} from 'lucide-react';
export const capabilityNames={'workspace.read':'读取工作目录','artifact.write':'保存文本产物','desktop.terminal':'使用交互终端','desktop.browser':'浏览网页','agent.spawn':'启动 Agent','notifications.send':'发送通知'};
export function PluginIcon({plugin,size=20}){const contribution=(plugin.manifest?.contributions??[]).find(c=>c.surface==='workspace.tool');const Icon=({folder:Folder,browser:Globe,changes:GitBranch,terminal:Terminal})[contribution?.icon]??Blocks;return <Icon size={size} strokeWidth={1.7} aria-hidden="true"/>;}
