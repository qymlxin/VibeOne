import type { DesktopChannelEvent, DesktopCommand, DesktopCommandMap } from "../electron/ipc.ts";
import "./electron-desktop.css";

/** 调用桌面主进程暴露的 IPC 命令 */
export function invoke<C extends DesktopCommand>(
  command: C,
  args?: DesktopCommandMap[C]["args"] | Record<string, unknown>,
): Promise<DesktopCommandMap[C]["result"]>;
export function invoke(
  command: string,
  args?: Record<string, unknown>,
): Promise<unknown>;
export function invoke(
  command: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  if (!window.vibeoneDesktop) {
    return Promise.reject(new Error("此功能需要在桌面应用中使用"));
  }
  const events = args.events as Channel | { id?: string } | undefined;
  return window.vibeoneDesktop.invoke(
    command,
    events?.id ? { ...args, events: { channel: events.id } } : args,
  );
}

/** 桌面流式事件通道标识 */
export class Channel {
  id: string;
  onmessage?: (event: DesktopChannelEvent) => void;

  constructor() {
    this.id = crypto.randomUUID();
  }

  toJSON(): { channel: string } {
    return { channel: this.id };
  }
}

/** 创建一条桌面流式事件通道并绑定取消订阅函数 */
export function streamChannel(): { events: Channel; dispose: () => void } {
  const events = new Channel();
  const dispose =
    window.vibeoneDesktop?.onChannel(events.id, (event) =>
      events.onmessage?.(event),
    ) ?? (() => {});
  return { events, dispose };
}

if (typeof window !== "undefined" && window.vibeoneDesktop) {
  document.documentElement.classList.add("electron-desktop");
}
