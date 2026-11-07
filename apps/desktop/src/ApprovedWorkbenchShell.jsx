import React from 'react';
import {Folder,ChevronRight,PanelLeft,GitCompareArrows,FolderOpen,Terminal,Globe,MoreHorizontal} from 'lucide-react';
export const primaryTools=[['changes','变更',GitCompareArrows],['files','文件',FolderOpen],['terminal','终端',Terminal],['browser','网址浏览',Globe]];
export function IconButton({label,children,onClick,active=false,...props}){return <button className={`icon-button ${active?'active':''}`} title={label} aria-label={label} aria-pressed={active} onClick={onClick} {...props}>{children}</button>;}
export function ApprovedWorkbenchShell({dark,colorStyle,sidebarOpen,hasPanel,wide,settings,native,mobileList,title,connectionLabel,onToggleSidebar,onOpenList,panel,onPanel,sidebar,children}){
 return <div className={`review-app desktop-app ${dark?'dark':'light'} ${sidebarOpen?'':'no-sidebar sidebar-closed'} ${hasPanel?'has-panel':''} ${wide&&hasPanel?'wide-panel':''} ${settings?'settings-open':''} ${native?'native-desktop':''} ${mobileList?'mobile-list':''}`} style={colorStyle}>
  <header className="windowbar desktop-connection" data-tauri-drag-region>
   <IconButton label={sidebarOpen?'收起会话栏':'展开会话栏'} onClick={onToggleSidebar}><PanelLeft size={15}/></IconButton>
   <button className="mobile-open-list" onClick={onOpenList}>会话列表</button>
   <span className="window-title" data-tauri-drag-region><Folder size={13}/> VibeOne <ChevronRight size={12}/> {settings?'设置':title}</span>
   <span className="review-badge">{connectionLabel}</span>
   <div className="window-actions">{primaryTools.map(([key,label,Icon])=><IconButton key={key} label={`打开${label}`} active={hasPanel&&panel===key} onClick={()=>onPanel(hasPanel&&panel===key?'chat':key)}><Icon size={16}/></IconButton>)}<details className="workbench-tool-menu"><summary className="icon-button" aria-label="更多工具" title="更多工具"><MoreHorizontal size={16}/></summary><div>{[['runs','执行记录'],['artifacts','产物'],['agent','Agent 设置']].map(([id,label])=><button key={id} onClick={event=>{event.currentTarget.closest('details').open=false;onPanel(id);}}>{label}</button>)}</div></details></div>
  </header>
  {sidebarOpen&&!settings&&sidebar}
  <main className="desktop-main">{children}</main>
 </div>;
}
