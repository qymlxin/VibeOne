import { useEffect, useRef } from "react";
import { isNative } from "./api.js";

export async function enableNotifications() {
  if (isNative()) {
    const api = await import("@tauri-apps/plugin-notification");
    if (
      !(await api.isPermissionGranted()) &&
      (await api.requestPermission()) !== "granted"
    )
      throw Error("系统通知权限未开启");
  } else {
    if (
      !("Notification" in window) ||
      (await Notification.requestPermission()) !== "granted"
    )
      throw Error("浏览器通知不可用或未获授权");
  }
  localStorage.setItem("vibeone-notifications", "enabled");
}
async function notify(title, body) {
  if (localStorage.getItem("vibeone-notifications") !== "enabled") return;
  if (isNative()) {
    const api = await import("@tauri-apps/plugin-notification");
    if (await api.isPermissionGranted()) api.sendNotification({ title, body });
  } else if ("Notification" in window && Notification.permission === "granted")
    new Notification(title, { body });
}
export function useNotifications(workbench) {
  const previous = useRef(null);
  useEffect(() => {
    if (workbench.phase !== "online") return;
    const current = new Map();
    for (const session of workbench.sessions) {
      for (const request of [...session.approvals, ...(session.inputs ?? [])])
        current.set(`attention:${request.id}`, {
          title: "VibeOne · 需要处理",
          body: session.title,
        });
      for (const run of session.runs ?? [])
        if (["completed", "failed", "cancelled"].includes(run.status))
          current.set(`run:${run.id}:${run.status}`, {
            title: "VibeOne · 执行结束",
            body: `${session.title} · ${run.status}`,
          });
    }
    for (const notification of workbench.notifications ?? [])
      current.set(`plugin:${notification.id}`, {
        title: "VibeOne · 插件通知",
        body: notification.message,
      });
    if (previous.current)
      for (const [id, message] of current)
        if (!previous.current.has(id))
          void notify(message.title, message.body).catch(() => {});
    previous.current = current;
  }, [workbench.sessions, workbench.notifications, workbench.phase]);
}
