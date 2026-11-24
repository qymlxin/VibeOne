import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import {
  DESKTOP_COMMANDS,
  type DesktopBridge,
  type DesktopChannelEvent,
  type DesktopCommand,
} from "./ipc.ts";

// Preload 脚本运行在隔离上下文中，仅暴露白名单命令与事件订阅接口
const allowedCommands = new Set<string>(DESKTOP_COMMANDS);

interface ChannelPayload {
  id: string;
  event: DesktopChannelEvent;
}

const bridge: DesktopBridge = {
  invoke(command: string, args: Record<string, unknown> = {}) {
    if (!allowedCommands.has(command)) {
      return Promise.reject(new Error("未知桌面命令"));
    }
    return ipcRenderer.invoke(
      "vibeone:command",
      command as DesktopCommand,
      args,
    );
  },
  onChannel(id: string, callback: (event: DesktopChannelEvent) => void) {
    const listener = (_event: IpcRendererEvent, message: ChannelPayload) => {
      if (message.id === id) {
        callback(message.event);
      }
    };
    ipcRenderer.on("vibeone:channel", listener);
    return () => {
      ipcRenderer.removeListener("vibeone:channel", listener);
    };
  },
};

contextBridge.exposeInMainWorld("vibeoneDesktop", Object.freeze(bridge));
