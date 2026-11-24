// Electron 主进程与渲染进程共享的 IPC 契约定义

/** 允许通过桌面桥接调用的全部 IPC 命令名称列表 */
export const DESKTOP_COMMANDS = [
  "plugin_fetch",
  "project_details",
  "host_connection",
  "restart_host",
  "choose_workspace",
  "open_external",
  "export_remote_certificate",
  "notification_permission",
  "request_notification_permission",
  "desktop_notify",
  "terminal_open",
  "terminal_write",
  "terminal_resize",
  "terminal_close",
  "browser_open",
  "browser_layout",
  "browser_action",
] as const;

export type DesktopCommand = (typeof DESKTOP_COMMANDS)[number];

/** 主机连接信息 */
export interface HostConnectionInfo {
  url: string;
  token: string;
  persistent?: boolean;
  dataDirectory?: string;
}

/** 单个项目的 Git 分支与路径详情 */
export interface ProjectDetailItem {
  id: string;
  path: string | null;
  branch: string | null;
}

/** 项目详情查询结果 */
export interface ProjectDetailsResult {
  projects: ProjectDetailItem[];
  homeDirectory: string;
}

/** 插件源抓取到的单个包信息 */
export interface PluginPackageEntry {
  path: string;
  source: {
    repository: string;
    directory: string;
    revision: string;
  };
  manifest: Record<string, unknown>;
}

/** 插件源抓取结果 */
export type PluginFetchResult =
  | {
      packages: PluginPackageEntry[];
      warnings: string[];
      source: {
        repository: string;
        revision: string;
      };
    }
  | {
      path: string;
      source: {
        repository: string;
        directory: string;
        revision: string;
      };
    };

/** 通知权限状态结果 */
export interface NotificationPermissionResult {
  status: "granted" | "denied" | "default" | "unsupported";
  source: string;
}

/** 内嵌浏览器视图位置与尺寸 */
export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 流式事件通道引用 */
export interface ChannelReference {
  id?: string;
  channel?: string;
}

/** 终端与浏览器通道推送事件 */
export type DesktopChannelEvent =
  | { type: "data"; data: number[] }
  | { type: "exit"; code: number }
  | { state: "loading" | "loaded" | "error"; url: string }
  | Record<string, unknown>;

/** 各桌面命令的请求参数与返回值映射 */
export interface DesktopCommandMap {
  plugin_fetch: {
    args: { repository: string; directory?: string };
    result: PluginFetchResult;
  };
  project_details: {
    args: { ids: string[] };
    result: ProjectDetailsResult;
  };
  host_connection: {
    args: Record<string, never> | undefined;
    result: HostConnectionInfo;
  };
  restart_host: {
    args: Record<string, never> | undefined;
    result: HostConnectionInfo;
  };
  choose_workspace: {
    args: Record<string, never> | undefined;
    result: string | null;
  };
  open_external: {
    args: { url: string };
    result: void;
  };
  export_remote_certificate: {
    args: Record<string, never> | undefined;
    result: string | undefined;
  };
  notification_permission: {
    args: Record<string, never> | undefined;
    result: NotificationPermissionResult;
  };
  request_notification_permission: {
    args: Record<string, never> | undefined;
    result: NotificationPermissionResult;
  };
  desktop_notify: {
    args: { options: { title: string; body?: string } };
    result: void;
  };
  terminal_open: {
    args: {
      id: string;
      cwd: string;
      cols: number;
      rows: number;
      events?: ChannelReference;
    };
    result: string;
  };
  terminal_write: {
    args: { id: string; data: string };
    result: void;
  };
  terminal_resize: {
    args: { id: string; cols: number; rows: number };
    result: void;
  };
  terminal_close: {
    args: { id: string };
    result: void;
  };
  browser_open: {
    args: {
      id: string;
      address: string;
      bounds: BrowserBounds;
      events?: ChannelReference;
    };
    result: void;
  };
  browser_layout: {
    args: {
      id: string;
      visible: boolean;
      bounds: BrowserBounds;
    };
    result: void;
  };
  browser_action: {
    args: {
      id: string;
      action: "close" | "navigate" | "reload" | "back" | "forward";
      address?: string;
    };
    result: void;
  };
}

/** 渲染进程通过 contextBridge 访问的桌面桥接接口 */
export interface DesktopBridge {
  invoke<C extends DesktopCommand>(
    command: C,
    args?: DesktopCommandMap[C]["args"] | Record<string, unknown>,
  ): Promise<DesktopCommandMap[C]["result"]>;
  invoke(
    command: string,
    args?: Record<string, unknown>,
  ): Promise<unknown>;
  onChannel(
    id: string,
    callback: (event: DesktopChannelEvent) => void,
  ): () => void;
}
