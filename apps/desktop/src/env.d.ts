/// <reference types="vite/client" />
import type { DesktopBridge } from "../electron/ipc.ts";

declare global {
  interface Window {
    vibeoneDesktop?: DesktopBridge;
    // 兼容桌面集成测试中注入的模拟桥接
    __TAURI_INTERNALS__?: {
      invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
    };
  }
}
