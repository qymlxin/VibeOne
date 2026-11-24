import {
  BrowserWindow,
  Notification,
  WebContentsView,
  app,
  dialog,
  ipcMain,
  net,
  protocol,
  session,
  shell,
} from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { IPty } from "node-pty";
import type {
  BrowserBounds,
  DesktopChannelEvent,
  DesktopCommandMap,
  HostConnectionInfo,
} from "./ipc.ts";
import { fetchPluginSource } from "./plugin-source.ts";
import { projectDetails, type HostProjectSummary } from "./project-details.ts";

declare global {
  // 开发引导脚本注入的异步就绪 Promise
  var vibeoneDevReady: Promise<void> | undefined;
}

interface ManagedBrowser {
  view: WebContentsView;
  visible: boolean;
}

interface HostSessionSummary {
  status: string;
  approvals?: unknown[];
  inputs?: unknown[];
}

interface HostOperationSummary {
  state: string;
}

interface HostSnapshotSummary {
  sessions: HostSessionSummary[];
  operations?: HostOperationSummary[];
}

const root = path.resolve(__dirname, "../../..");
const resources =
  process.env.VIBEONE_RESOURCES_DIR ||
  (app.isPackaged
    ? path.join(process.resourcesPath, "host")
    : path.join(root, "target/desktop-resources"));
const data = process.env.VIBEONE_DATA_DIR || path.join(os.homedir(), ".vibeone");

let mainWindow: BrowserWindow | null = null;
let launching: Promise<HostConnectionInfo> | null = null;
const browsers = new Map<string, ManagedBrowser>();
const terminals = new Map<string, IPty>();

// 必须在 app.ready 前注册特权自定义协议
protocol.registerSchemesAsPrivileged([
  {
    scheme: "vibeone",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

app.setName("VibeOne");
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** 校验并规范化外部或内嵌浏览器允许访问的 HTTP/HTTPS 地址 */
function webUrl(value: string): string {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("只支持HTTP/HTTPS网址");
  }
  return url.href;
}

/** 探测本地工作主机是否健康且协议版本匹配 */
async function healthy(): Promise<HostConnectionInfo | null> {
  try {
    const config = JSON.parse(
      fs.readFileSync(path.join(data, "host.json"), "utf8"),
    ) as HostConnectionInfo;
    if (new URL(config.url).hostname !== "127.0.0.1") {
      return null;
    }
    const response = await fetch(`${config.url}/v1/health`, {
      headers: { Authorization: `Bearer ${config.token}` },
      signal: AbortSignal.timeout(1200),
    });
    const health = (await response.json()) as {
      name?: string;
      protocolVersion?: number;
      persistent?: boolean;
    };
    return response.ok &&
      health.name === "vibeone-host" &&
      health.protocolVersion === 2
      ? { ...config, persistent: health.persistent, dataDirectory: data }
      : null;
  } catch {
    return null;
  }
}

/** 连接或按需拉起本地工作主机进程 */
async function connect(): Promise<HostConnectionInfo> {
  if (launching) {
    return launching;
  }
  launching = (async () => {
    const current = await healthy();
    if (current) {
      return current;
    }
    fs.mkdirSync(data, { recursive: true, mode: 0o700 });
    const binary =
      process.env.VIBEONE_HOST_BIN ||
      path.join(
        resources,
        "bin",
        process.platform === "win32" ? "vibeone-host.exe" : "vibeone-host",
      );
    const log = fs.openSync(path.join(data, "host.log"), "a", 0o600);
    try {
      const child = spawn(binary, ["serve", "--data-dir", data], {
        detached: true,
        stdio: ["ignore", "ignore", log],
        env: {
          ...process.env,
          VIBEONE_BRIDGES_DIR: path.join(resources, "bridges"),
          VIBEONE_RUNTIME_DIR: path.join(resources, "runtime"),
          VIBEONE_WEB_DIR: path.join(resources, "web"),
          VIBEONE_EXAMPLE_PLUGIN: path.join(
            resources,
            "examples/workspace-tools",
          ),
        },
      });
      let failure: Error | undefined;
      child.on("error", (error) => {
        failure = error;
      });
      child.unref();
      for (let i = 0; i < 160; i++) {
        if (failure) {
          throw failure;
        }
        await sleep(100);
        const info = await healthy();
        if (info) {
          return info;
        }
      }
      throw new Error("工作主机启动超时，请查看host.log");
    } finally {
      fs.closeSync(log);
    }
  })().finally(() => {
    launching = null;
  });
  return launching;
}

/** 向本地工作主机发起内部 HTTP 请求 */
async function hostCall<T>(endpoint: string, body?: unknown): Promise<T> {
  const info = await connect();
  const response = await fetch(`${info.url}/v1${endpoint}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${info.token}`,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    throw new Error("工作主机请求失败");
  }
  return (await response.json()) as T;
}

const isSessionBusy = (item: HostSessionSummary): boolean =>
  ["starting", "running", "requires_action", "cancelling"].includes(
    item.status,
  ) ||
  Boolean(item.approvals?.length) ||
  Boolean(item.inputs?.length);

/** 向渲染进程通道推送事件 */
function emit(channel: string | undefined, event: DesktopChannelEvent): void {
  if (
    mainWindow &&
    !mainWindow.isDestroyed() &&
    !mainWindow.webContents.isDestroyed() &&
    channel
  ) {
    mainWindow.webContents.send("vibeone:channel", { id: channel, event });
  }
}

/** 将相对容器矩形约束在主窗口内容区范围内 */
function applyBounds(view: WebContentsView, rect: BrowserBounds): void {
  if (!mainWindow) {
    return;
  }
  const [width = 0, height = 0] = mainWindow.getContentSize();
  const x = Math.max(0, Math.round(rect.x));
  const y = Math.max(0, Math.round(rect.y));
  view.setBounds({
    x,
    y,
    width: Math.max(1, Math.min(width - x, Math.round(rect.width))),
    height: Math.max(1, Math.min(height - y, Math.round(rect.height))),
  });
}

function closeBrowser(id: string): void {
  const item = browsers.get(id);
  if (!item || !mainWindow) {
    return;
  }
  mainWindow.contentView.removeChildView(item.view);
  item.view.webContents.close();
  browsers.delete(id);
}

ipcMain.handle(
  "vibeone:command",
  async (event, command: string, rawArgs: Record<string, unknown> = {}) => {
    if (
      !mainWindow ||
      event.sender !== mainWindow.webContents ||
      event.senderFrame !== mainWindow.webContents.mainFrame
    ) {
      throw new Error("此页面无桌面权限");
    }

    switch (command) {
      case "plugin_fetch": {
        const args = rawArgs as DesktopCommandMap["plugin_fetch"]["args"];
        return fetchPluginSource(data, args);
      }
      case "host_connection":
        return connect();
      case "project_details": {
        const args = rawArgs as DesktopCommandMap["project_details"]["args"];
        const response = await hostCall<{ projects: HostProjectSummary[] }>(
          "/projects",
        );
        return projectDetails(response.projects, args.ids);
      }
      case "restart_host": {
        const info = await connect();
        const snapshot = await hostCall<HostSnapshotSummary>("/snapshot");
        if (
          snapshot.sessions.some(isSessionBusy) ||
          snapshot.operations?.some((op) =>
            ["accepted", "running"].includes(op.state),
          )
        ) {
          throw new Error("请等待任务结束后重启主机");
        }
        await fetch(`${info.url}/v1/host/stop`, {
          method: "POST",
          headers: { Authorization: `Bearer ${info.token}` },
        });
        for (let i = 0; i < 160; i++) {
          if (!fs.existsSync(path.join(data, "host.json"))) {
            return connect();
          }
          await sleep(100);
        }
        throw new Error("旧主机尚未退出");
      }
      case "choose_workspace": {
        const result = await dialog.showOpenDialog(mainWindow, {
          properties: ["openDirectory", "createDirectory"],
        });
        return result.canceled ? null : (result.filePaths[0] ?? null);
      }
      case "open_external": {
        const args = rawArgs as DesktopCommandMap["open_external"]["args"];
        await shell.openExternal(webUrl(args.url));
        return;
      }
      case "export_remote_certificate": {
        const certificate = path.join(data, "VibeOne-Root-CA.crt");
        if (!fs.existsSync(certificate)) {
          throw new Error("请先启用远程连接");
        }
        const result = await dialog.showSaveDialog(mainWindow, {
          defaultPath: "VibeOne-Root-CA.crt",
        });
        if (!result.canceled && result.filePath) {
          fs.copyFileSync(certificate, result.filePath);
        }
        return result.filePath;
      }
      case "notification_permission":
      case "request_notification_permission":
        return {
          status: Notification.isSupported() ? "granted" : "unsupported",
          source: "electron",
        };
      case "desktop_notify": {
        const args = rawArgs as DesktopCommandMap["desktop_notify"]["args"];
        if (Notification.isSupported()) {
          new Notification({
            title: String(args.options.title),
            body: String(args.options.body ?? ""),
          }).show();
        }
        return;
      }
      case "terminal_open": {
        const args = rawArgs as DesktopCommandMap["terminal_open"]["args"];
        if (terminals.has(args.id) || terminals.size >= 12) {
          throw new Error("终端数量已达上限");
        }
        const cwd = fs.realpathSync(args.cwd);
        if (!fs.statSync(cwd).isDirectory()) {
          throw new Error("目录不可用");
        }
        // 按需加载原生 node-pty 模块，避免非终端场景下提前初始化
        const pty = require("node-pty") as typeof import("node-pty");
        if (
          (!app.isPackaged || process.env.VIBEONE_DEV_URL) &&
          process.platform !== "win32"
        ) {
          const helper = path.join(
            path.dirname(require.resolve("node-pty/package.json")),
            "prebuilds",
            `${process.platform}-${process.arch}`,
            "spawn-helper",
          );
          if (fs.existsSync(helper)) {
            fs.chmodSync(helper, 0o755);
          }
        }
        const shellPath =
          process.env.SHELL ||
          (process.platform === "win32" ? "powershell.exe" : "/bin/zsh");
        const terminal = pty.spawn(
          shellPath,
          process.platform === "win32" ? [] : ["-l"],
          {
            name: "xterm-256color",
            cwd,
            cols: Math.max(2, Math.min(500, args.cols)),
            rows: Math.max(2, Math.min(300, args.rows)),
            env: {
              ...process.env,
              TERM: "xterm-256color",
              COLORTERM: "truecolor",
            },
          },
        );
        terminals.set(args.id, terminal);
        const channelId = args.events?.id || args.events?.channel;
        terminal.onData((chunk) =>
          emit(channelId, { type: "data", data: [...Buffer.from(chunk)] }),
        );
        terminal.onExit((exitEvent) => {
          terminals.delete(args.id);
          emit(channelId, { type: "exit", code: exitEvent.exitCode });
        });
        return `${os.userInfo().username}@${os.hostname()}:${path.basename(cwd)}`;
      }
      case "terminal_write": {
        const args = rawArgs as DesktopCommandMap["terminal_write"]["args"];
        if (typeof args.data !== "string" || args.data.length > 65536) {
          throw new Error("终端输入过长");
        }
        terminals.get(args.id)?.write(args.data);
        return;
      }
      case "terminal_resize": {
        const args = rawArgs as DesktopCommandMap["terminal_resize"]["args"];
        terminals
          .get(args.id)
          ?.resize(
            Math.max(2, Math.min(500, args.cols)),
            Math.max(2, Math.min(300, args.rows)),
          );
        return;
      }
      case "terminal_close": {
        const args = rawArgs as DesktopCommandMap["terminal_close"]["args"];
        terminals.get(args.id)?.kill();
        terminals.delete(args.id);
        return;
      }
      case "browser_open": {
        const args = rawArgs as DesktopCommandMap["browser_open"]["args"];
        if (browsers.size >= 12) {
          throw new Error("网页数量已达上限");
        }
        if (browsers.has(args.id)) {
          closeBrowser(args.id);
        }
        const view = new WebContentsView({
          webPreferences: {
            partition: "persist:vibeone-browser",
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
          },
        });
        const item: ManagedBrowser = { view, visible: true };
        browsers.set(args.id, item);
        const channel = args.events?.id || args.events?.channel;
        const report = (state: "loading" | "loaded" | "error") => {
          if (!view.webContents.isDestroyed()) {
            emit(channel, { state, url: view.webContents.getURL() });
          }
        };
        view.webContents.on("did-start-loading", () => report("loading"));
        view.webContents.on("did-stop-loading", () => report("loaded"));
        view.webContents.on("did-navigate", () => report("loaded"));
        view.webContents.on("did-navigate-in-page", () => report("loaded"));
        view.webContents.on("did-fail-load", (_e, code) => {
          if (code !== -3) {
            report("error");
          }
        });
        view.webContents.on("will-navigate", (navEvent, url) => {
          try {
            webUrl(url);
          } catch {
            navEvent.preventDefault();
          }
        });
        view.webContents.setWindowOpenHandler(({ url }) => {
          try {
            void view.webContents.loadURL(webUrl(url));
          } catch {
            // 忽略非 HTTP/HTTPS 弹窗链接
          }
          return { action: "deny" };
        });
        mainWindow.contentView.addChildView(view);
        applyBounds(view, args.bounds);
        void view.webContents
          .loadURL(webUrl(args.address))
          .catch(() => report("error"));
        return;
      }
      case "browser_layout": {
        const args = rawArgs as DesktopCommandMap["browser_layout"]["args"];
        const item = browsers.get(args.id);
        if (!item) {
          return;
        }
        if (args.visible !== item.visible) {
          if (args.visible) {
            mainWindow.contentView.addChildView(item.view);
          } else {
            mainWindow.contentView.removeChildView(item.view);
          }
          item.visible = args.visible;
        }
        applyBounds(item.view, args.bounds);
        return;
      }
      case "browser_action": {
        const args = rawArgs as DesktopCommandMap["browser_action"]["args"];
        const item = browsers.get(args.id);
        if (!item) {
          return;
        }
        const wc = item.view.webContents;
        if (args.action === "close") {
          closeBrowser(args.id);
        } else if (args.action === "navigate" && args.address) {
          void wc.loadURL(webUrl(args.address));
        } else if (args.action === "reload") {
          wc.reload();
        } else if (args.action === "back" && wc.navigationHistory.canGoBack()) {
          wc.navigationHistory.goBack();
        } else if (
          args.action === "forward" &&
          wc.navigationHistory.canGoForward()
        ) {
          wc.navigationHistory.goForward();
        }
        return;
      }
      default:
        throw new Error("未知桌面命令");
    }
  },
);

app
  .whenReady()
  .then(async () => {
    await globalThis.vibeoneDevReady;
    protocol.handle("vibeone", (request) => {
      const url = new URL(request.url);
      if (url.hostname !== "app") {
        throw new Error("Invalid application origin");
      }
      const base = path.resolve(__dirname, "../dist");
      const file = path.resolve(base, `.${decodeURIComponent(url.pathname)}`);
      if (!file.startsWith(base + path.sep)) {
        throw new Error("Invalid application path");
      }
      return net.fetch(pathToFileURL(file).href);
    });

    const browsing = session.fromPartition("persist:vibeone-browser");
    browsing.setPermissionRequestHandler((_wc, _permission, callback) =>
      callback(false),
    );
    browsing.setPermissionCheckHandler(() => false);

    mainWindow = new BrowserWindow({
      width: 1480,
      height: 940,
      minWidth: 900,
      minHeight: 620,
      title: "VibeOne",
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 14, y: 12 },
      backgroundColor: "#181818",
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });

    mainWindow.webContents.on("will-navigate", (event) =>
      event.preventDefault(),
    );
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      try {
        void shell.openExternal(webUrl(url));
      } catch {
        // 忽略非法协议链接
      }
      return { action: "deny" };
    });
    mainWindow.on("closed", () => {
      for (const terminal of terminals.values()) {
        terminal.kill();
      }
      for (const item of browsers.values()) {
        item.view.webContents.close();
      }
      browsers.clear();
      terminals.clear();
      mainWindow = null;
    });

    if (process.env.VIBEONE_DEV_URL) {
      await mainWindow.loadURL(process.env.VIBEONE_DEV_URL);
    } else {
      await mainWindow.loadURL("vibeone://app/index.html");
    }
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox("VibeOne启动失败", message);
    app.quit();
  });

app.on("window-all-closed", () => app.quit());
