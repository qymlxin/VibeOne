import React, { useCallback, useEffect, useRef, useState } from "react";
import { Info, RefreshCw } from "lucide-react";
import { Alert } from "./components/ui/alert.tsx";
import { Badge } from "./components/ui/badge.tsx";
import { Button } from "./components/ui/button.tsx";
import { SettingItem, SettingSection } from "./components/ui/setting-layout.tsx";
import { Switch } from "./components/ui/switch.tsx";
import {
  canNotify,
  enableNotifications,
  notificationPermission,
} from "./notifications.ts";

const labels: Record<string, string> = {
  granted: "已授权",
  denied: "未授权，请检查系统设置",
  default: "尚未请求",
  provisional: "已临时授权",
  ephemeral: "已临时授权",
  unsupported: "当前浏览器不支持通知",
  unavailable: "当前平台未提供系统权限查询",
  unknown: "系统返回未知权限状态",
};

export function NotificationSettings() {
  const [enabled, setEnabled] = useState(() => {
    try {
      return localStorage.getItem("vibeone-notifications") === "enabled";
    } catch {
      return false;
    }
  });
  const [permission, setPermission] = useState<{
    status: string;
    source: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const epoch = useRef(0);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    const current = ++epoch.current;
    setChecking(true);
    setReadError("");
    try {
      const result = await notificationPermission();
      if (mounted.current && current === epoch.current) {
        setPermission(result);
      }
    } catch (err) {
      if (mounted.current && current === epoch.current) {
        setPermission(null);
        setReadError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (mounted.current && current === epoch.current) {
        setChecking(false);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    return () => {
      mounted.current = false;
      epoch.current++;
      window.removeEventListener("focus", focus);
    };
  }, [refresh]);

  async function toggle() {
    setBusy(true);
    setError("");
    try {
      if (enabled) {
        localStorage.removeItem("vibeone-notifications");
        if (mounted.current) {
          setEnabled(false);
        }
      } else {
        await enableNotifications();
        if (mounted.current) {
          setEnabled(true);
        }
      }
    } catch (err) {
      if (mounted.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (mounted.current) {
        setBusy(false);
        void refresh();
      }
    }
  }

  const permissionOk = permission ? canNotify(permission.status) : false;

  return (
    <>
      <SettingSection title="桌面通知">
        <SettingItem
          title="审批与执行结束提醒"
          description="开启时请求通知权限。关闭只停止本设备发送提醒。"
        >
          {busy && (
            <span role="status" className="text-[12px] text-[var(--muted)]">
              正在更新…
            </span>
          )}
          <Switch
            aria-label="桌面通知"
            checked={enabled}
            disabled={busy}
            onCheckedChange={() => void toggle()}
          />
        </SettingItem>
        <SettingItem
          title="系统权限"
          description="与本设备的提醒开关独立；系统更改后可刷新状态。"
        >
          <Badge
            role="status"
            variant={
              checking ? "secondary" : permissionOk ? "success" : "warning"
            }
          >
            {checking
              ? "正在查询…"
              : permission
                ? (labels[permission.status] ?? labels.unknown)
                : "无法读取权限状态"}
          </Badge>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={checking || busy}
            onClick={() => void refresh()}
          >
            <RefreshCw size={13} className={checking ? "animate-spin" : ""} />
            刷新通知权限
          </Button>
        </SettingItem>
      </SettingSection>

      {enabled && permission && !permissionOk && (
        <Alert variant="warning" role="status" className="my-4">
          <Info size={15} className="mt-0.5 shrink-0" />
          <span>
            提醒开关已开启，但
            {permission.status === "unavailable"
              ? "是否弹出仍由系统设置决定。"
              : "当前没有可用的通知授权。"}
          </span>
        </Alert>
      )}

      {(error || readError) && (
        <Alert variant="destructive" role="alert" className="my-4">
          {[error, readError].filter(Boolean).join("；")}
        </Alert>
      )}

      <SettingSection title="通知事件">
        <div className="px-5 py-4 text-[12.5px] leading-relaxed text-[var(--ink-secondary)]">
          新出现的权限审批、补充输入和执行结束会触发提醒。首次连接只建立历史基线，不补发此前的执行记录。插件通知渠道继续在插件页管理。
        </div>
      </SettingSection>
    </>
  );
}
