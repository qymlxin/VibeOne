import React from 'react';
import {Folder,ChevronRight,PanelLeft,GitCompareArrows,FolderOpen,Terminal,Globe,MoreHorizontal,PanelRight} from 'lucide-react';
export const primaryTools=[['changes','变更',GitCompareArrows],['files','文件',FolderOpen],['terminal','终端',Terminal],['browser','网址浏览',Globe]];
export function IconButton({label,children,onClick,active=false,...props}){return <button className={`icon-button ${active?'active':''}`} title={label} aria-label={label} aria-pressed={active} onClick={onClick} {...props}>{children}</button>;}
export function ApprovedWorkbenchShell({dark,colorStyle,sidebarOpen,hasPanel,wide,settings,native,mobileList,title,connectionLabel,navigation,onToggleSidebar,onOpenList,panel,onPanel,sidebar,children}){
 return <div className={`review-app desktop-app ${dark?'dark':'light'} ${sidebarOpen?'':'no-sidebar sidebar-closed'} ${hasPanel?'has-panel':''} ${wide&&hasPanel?'wide-panel':''} ${settings?'settings-open':''} ${native?'native-desktop':''} ${mobileList?'mobile-list':''}`} style={colorStyle}>
  <header className="windowbar desktop-connection">
   <IconButton label={sidebarOpen?'收起会话栏':'展开会话栏'} onClick={onToggleSidebar}><PanelLeft size={15}/></IconButton>
   <button className="mobile-open-list" onClick={onOpenList}>会话列表</button>
   <span className="window-title"><Folder size={13}/> VibeOne <ChevronRight size={12}/> {settings?'设置':title}</span>
   {navigation}<span className="review-badge">{connectionLabel}</span>
   <div className="window-actions"><IconButton label={hasPanel?'收起工作区':'展开工作区'} active={hasPanel} onClick={()=>onPanel(hasPanel?'chat':'home')}><PanelRight size={17}/></IconButton></div>
  </header>
  {sidebarOpen&&!settings&&sidebar}
  <main className="desktop-main">{children}</main>
 </div>;
}
