import React from "react";
import {
  ChevronRight,
  Folder,
  GitCompareArrows,
  FolderOpen,
  Globe,
  PanelLeft,
  PanelRight,
  Terminal,
} from "lucide-react";
import { SplitHandle } from "./SplitHandle.tsx";

export const primaryTools = [
  ["changes", "变更", GitCompareArrows],
  ["files", "文件", FolderOpen],
  ["terminal", "终端", Terminal],
  ["browser", "网址浏览", Globe],
] as const;

export function IconButton({
  label,
  children,
  onClick,
  active = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  active?: boolean;
}) {
  return (
    <button
      className={`icon-button ${active ? "active" : ""}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      {...props}
    >
      {children}
    </button>
  );
}

export function ApprovedWorkbenchShell({
  dark,
  colorStyle,
  sidebarOpen,
  hasPanel,
  wide,
  settings,
  native,
  mobileList,
  title,
  connectionLabel,
  navigation,
  onToggleSidebar,
  onResizeSidebar,
  onExpandSidebar,
  onCollapseSidebar,
  onOpenList,
  onPanel,
  sidebar,
  children,
}: {
  dark: boolean;
  colorStyle: React.CSSProperties;
  sidebarOpen: boolean;
  hasPanel: boolean;
  wide: boolean;
  settings: boolean;
  native: boolean;
  mobileList: boolean;
  title: string;
  connectionLabel: string;
  navigation?: React.ReactNode;
  onToggleSidebar: () => void;
  onResizeSidebar: (width: number) => void;
  onExpandSidebar: () => void;
  onCollapseSidebar: () => void;
  onOpenList: () => void;
  panel?: string;
  onPanel: (panel: string) => void;
  sidebar: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`review-app desktop-app ${dark ? "dark" : "light"} ${sidebarOpen ? "" : "no-sidebar sidebar-closed"} ${hasPanel ? "has-panel" : ""} ${wide && hasPanel ? "wide-panel" : ""} ${settings ? "settings-open" : ""} ${native ? "native-desktop" : ""} ${mobileList ? "mobile-list" : ""}`}
      style={colorStyle}
    >
      <header className="windowbar desktop-connection">
        <IconButton
          label={sidebarOpen ? "收起会话栏" : "展开会话栏"}
          onClick={onToggleSidebar}
        >
          <PanelLeft size={15} />
        </IconButton>
        <button className="mobile-open-list" onClick={onOpenList}>
          会话列表
        </button>
        <span className="window-title">
          <Folder size={13} /> VibeOne <ChevronRight size={12} />{" "}
          {settings ? "设置" : title}
        </span>
        {navigation}
        <span className="review-badge">{connectionLabel}</span>
        <div className="window-actions">
          <IconButton
            label={hasPanel ? "收起工作区" : "展开工作区"}
            active={hasPanel}
            onClick={() => onPanel(hasPanel ? "chat" : "home")}
          >
            <PanelRight size={17} />
          </IconButton>
        </div>
      </header>
      <div
        className="sidebar-resize-slot"
        hidden={!sidebarOpen || settings}
        inert={!sidebarOpen || settings ? true : undefined}
      >
        {sidebar}
      </div>
      <SplitHandle
        scope="sidebar"
        minimum={200}
        label="调整左侧会话栏宽度"
        hidden={settings}
        collapsed={!sidebarOpen}
        onResize={onResizeSidebar}
        onCollapse={onCollapseSidebar}
        onExpand={onExpandSidebar}
      />
      <main className="desktop-main">{children}</main>
    </div>
  );
}
