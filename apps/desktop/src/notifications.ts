import { useEffect, useRef } from "react";
import { isNative } from "./api.ts";
import { invoke } from "./native.ts";

export const canNotify = (status: string): boolean =>
  ["granted", "provisional", "ephemeral"].includes(status);

export async function notificationPermission(): Promise<{
  status: string;
  source: string;
}> {
  if (isNative()) {
    return invoke("notification_permission");
  }
  return {
    status: "Notification" in window ? Notification.permission : "unsupported",
    source: "browser",
  };
}

export async function enableNotifications(): Promise<void> {
  if (isNative()) {
    const result = await invoke("request_notification_permission");
    if (!canNotify(result.status)) {
      throw new Error("系统通知权限未开启，请在系统设置中允许 VibeOne 通知");
    }
  } else if (
    !("Notification" in window) ||
    (await Notification.requestPermission()) !== "granted"
  ) {
    throw new Error("浏览器通知不可用或未获授权");
  }
  localStorage.setItem("vibeone-notifications", "enabled");
}

async function notify(title: string, body: string): Promise<void> {
  if (localStorage.getItem("vibeone-notifications") !== "enabled") {
    return;
  }
  const { status } = await notificationPermission();
  if (!canNotify(status) && status !== "unavailable") {
    return;
  }
  if (localStorage.getItem("vibeone-notifications") !== "enabled") {
    return;
  }
  if (isNative()) {
    await invoke("desktop_notify", { options: { title, body } });
  } else {
    new Notification(title, { body });
  }
}

/** 监听工作台审批请求、Run 终态与插件通知并按需发送系统通知 */
export function useNotifications(workbench: {
  phase: string;
  revision?: number;
  sessions: Array<{
    title: string;
    approvals: Array<{ id: string }>;
    inputs?: Array<{ id: string }>;
    runs?: Array<{ id: string; status: string }>;
  }>;
  notifications?: Array<{ id?: string; message?: string; [key: string]: unknown }>;
}): void {
  const previous = useRef<Map<string, { title: string; body: string }> | null>(
    null,
  );
  useEffect(() => {
    if (workbench.phase !== "online" || workbench.revision == null) {
      previous.current = null;
      return;
    }
    const current = new Map<string, { title: string; body: string }>();
    for (const session of workbench.sessions) {
      for (const req of [...session.approvals, ...(session.inputs ?? [])]) {
        current.set(`attention:${req.id}`, {
          title: "VibeOne · 需要处理",
          body: session.title,
        });
      }
      for (const run of session.runs ?? []) {
        if (["completed", "failed", "cancelled"].includes(run.status)) {
          current.set(`run:${run.id}:${run.status}`, {
            title: "VibeOne · 执行结束",
            body: `${session.title} · ${run.status}`,
          });
        }
      }
    }
    for (const notification of workbench.notifications ?? []) {
      current.set(`plugin:${String(notification.id ?? "")}`, {
        title: "VibeOne · 插件通知",
        body: String(notification.message ?? ""),
      });
    }
    if (previous.current) {
      for (const [id, message] of current) {
        if (!previous.current.has(id)) {
          void notify(message.title, message.body).catch(() => {});
        }
      }
    }
    previous.current = current;
  }, [
    workbench.sessions,
    workbench.notifications,
    workbench.phase,
    workbench.revision,
  ]);
}
