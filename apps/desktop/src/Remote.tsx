import React, { useCallback, useEffect, useRef, useState } from "react";
import { Copy, KeyRound, ShieldCheck, Smartphone } from "lucide-react";
import type { RemoteStatusResponse } from "@vibeone/client-contracts";
import { exportRemoteCertificate } from "./api.ts";
import { Alert } from "./components/ui/alert.tsx";
import { Badge } from "./components/ui/badge.tsx";
import { Button } from "./components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card.tsx";
import { Input } from "./components/ui/input.tsx";
import { Select } from "./components/ui/select.tsx";
import {
  SettingBlock,
  SettingItem,
  SettingSection,
} from "./components/ui/setting-layout.tsx";
import {
  devicePresentation,
  remotePreferences,
} from "./remote-preferences.ts";
import { SettingsSwitch } from "./SettingsRows.tsx";
import type { WorkbenchLike } from "./types.ts";

export function RemoteSettings({ workbench }: { workbench: WorkbenchLike }) {
  const [state, setState] = useState<RemoteStatusResponse | null>(null);
  const [ip, setIp] = useState("");
  const [port, setPort] = useState("0");
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(
    null,
  );
  const [qr, setQr] = useState<{ url: string; svg: string } | null>(null);
  const [role, setRole] = useState("operator");
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [statusError, setStatusError] = useState("");
  const [busy, setBusy] = useState(false);

  const dirty = useRef(false);
  const request = useRef(0);
  const mounted = useRef(false);

  const refresh = useCallback(
    async (confirmed = false) => {
      const id = ++request.current;
      const value = await workbench.call<RemoteStatusResponse>("/devices");
      if (!mounted.current || id !== request.current) {
        return;
      }
      setState(value);
      if (confirmed || !dirty.current) {
        const preferences = remotePreferences(value);
        setIp(preferences.ip);
        setPort(preferences.port);
        dirty.current = false;
      }
    },
    [workbench.call],
  );

  useEffect(() => {
    mounted.current = true;
    const poll = () =>
      void refresh()
        .then(() => {
          if (mounted.current) {
            setStatusError("");
          }
        })
        .catch((err) => {
          if (mounted.current) {
            setStatusError(
              `远程状态读取失败：${err instanceof Error ? err.message : String(err)}`,
            );
          }
        });
    poll();
    const timer = setInterval(poll, 3000);
    return () => {
      mounted.current = false;
      ++request.current;
      clearInterval(timer);
    };
  }, [refresh]);

  async function run(action: () => Promise<unknown>, confirmConfiguration = false) {
    setBusy(true);
    setError("");
    try {
      await action();
      await refresh(confirmConfiguration);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const start = () =>
    void run(async () => {
      const result = await workbench.call<{ url: string; qr: string }>(
        "/remote",
        { enabled: true, ip, port: Number(port) },
      );
      setQr({ url: result.url, svg: result.qr });
    }, true);

  const stop = () =>
    void run(async () => {
      await workbench.call("/remote", { enabled: false });
      setCode(null);
      setQr(null);
    }, true);

  const qrSvg = state?.qr || (qr?.url === state?.url ? qr?.svg : undefined);

  return (
    <section className="desktop-remote-settings space-y-5">
      <p className="m-0 text-[13px] leading-relaxed text-[var(--ink-secondary)]">
        通过局域网或已有可信网络连接。首次配对需先在手机信任主机证书。
      </p>

      {state?.configuration?.enabled && !state.url && (
        <Alert variant="warning" role="status">
          配置已保存为开启，但当前入口未运行。请核对 IP 和端口后重新开启。
        </Alert>
      )}

      <SettingSection title="手机入口">
        <SettingItem
          title="HTTPS 远程访问"
          description="使用局域网或已有可信网络，不自动建立公网隧道。"
        >
          <Badge variant={state?.url ? "success" : "secondary"}>
            {state?.url ? "已开启" : "未开启"}
          </Badge>
          <SettingsSwitch
            label="HTTPS 手机入口"
            checked={Boolean(state?.url)}
            disabled={
              busy ||
              !state ||
              (!state.url &&
                (!ip || !/^\d+$/.test(port) || Number(port) > 65535))
            }
            onChange={(enabled) => (enabled ? start() : stop())}
          />
        </SettingItem>

        <SettingItem
          title="主机 IP"
          description="绑定用于局域网设备访问的本机网卡地址。"
        >
          <Input
            value={ip}
            aria-label="远程入口 IP"
            className="w-full font-mono sm:w-52"
            onChange={(event) => {
              dirty.current = true;
              setIp(event.target.value);
            }}
            disabled={busy || !state || Boolean(state.url)}
          />
        </SettingItem>

        <SettingItem
          title="端口"
          description="填写 0 表示由系统自动选择可用端口（范围 0 – 65535）。"
        >
          <Input
            type="number"
            min="0"
            max="65535"
            value={port}
            aria-label="远程入口端口"
            className="w-full font-mono sm:w-32"
            onChange={(event) => {
              dirty.current = true;
              setPort(event.target.value);
            }}
            disabled={busy || !state || Boolean(state.url)}
          />
        </SettingItem>

        {state?.url && (
          <SettingItem title="连接地址">
            <a
              href={state.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[12px] text-[var(--link)] underline underline-offset-4 [overflow-wrap:anywhere]"
            >
              {state.url}
            </a>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void run(() => navigator.clipboard.writeText(state.url ?? ""))
              }
            >
              <Copy size={13} />
              复制地址
            </Button>
          </SettingItem>
        )}
      </SettingSection>

      {state?.url && (
        <SettingSection title="首次配对">
          <SettingItem
            title="信任主机证书"
            description="在手机安装并信任此主机的 CA 证书，再打开 HTTPS 地址。"
          >
            <Button
              variant="outline"
              size="sm"
              onClick={() => void run(exportRemoteCertificate)}
            >
              <ShieldCheck size={14} />
              导出 CA 证书
            </Button>
          </SettingItem>

          <SettingItem title="证书文件">
            <code className="rounded-md bg-[var(--hover)] px-2.5 py-1 font-mono text-[11.5px] text-[var(--ink-secondary)] [overflow-wrap:anywhere]">
              {state.certificatePath}
            </code>
          </SettingItem>

          <SettingItem
            title="短期配对码"
            description="配对码有效期为 5 分钟，设备还需在电脑端确认授权。"
          >
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                void run(async () =>
                  setCode(
                    await workbench.call<{ code: string; expiresAt: number }>(
                      "/pairing/code",
                      {},
                    ),
                  ),
                )
              }
            >
              <KeyRound size={13} />
              生成 5 分钟配对码
            </Button>
          </SettingItem>

          {code && (
            <SettingItem title="配对码">
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-lg bg-[var(--accent-soft)] px-3 py-1 font-mono text-[18px] font-semibold tracking-[0.18em] text-[var(--fg)]">
                  {code.code}
                </span>
                <span className="text-[12px] text-[var(--muted)]">
                  截止 {new Date(code.expiresAt * 1000).toLocaleTimeString()}
                </span>
              </div>
            </SettingItem>
          )}

          {qrSvg && (
            <SettingBlock className="flex flex-col items-center gap-4 sm:flex-row">
              <div className="shrink-0 overflow-hidden rounded-xl bg-white p-2 shadow-xs">
                <img
                  className="desktop-remote-qr block size-[160px]"
                  alt="手机入口二维码"
                  src={`data:image/svg+xml,${encodeURIComponent(qrSvg)}`}
                />
              </div>
              <p className="m-0 text-[12.5px] leading-relaxed text-[var(--ink-secondary)]">
                手机信任证书后扫码，输入短期配对码，再回到电脑确认设备权限。
              </p>
            </SettingBlock>
          )}
        </SettingSection>
      )}

      {Boolean(state?.claims?.length) && (
        <SettingSection title="待确认的设备">
          <SettingItem
            title="默认设备权限"
            description="批准新设备前，请先选择其操作权限与可访问的工作区。"
          >
            <Select
              aria-label="设备权限"
              value={role}
              onChange={(event) => setRole(event.target.value)}
            >
              <option value="viewer">仅查看</option>
              <option value="approver">查看与审批</option>
              <option value="operator">查看、操作与审批</option>
            </Select>
          </SettingItem>

          <SettingBlock className="space-y-2.5">
            <div className="text-[12px] font-medium text-[var(--ink-secondary)]">
              授权工作区范围
            </div>
            <div className="flex flex-wrap gap-2">
              {(workbench.workspaces ?? []).map((workspace) => (
                <label
                  className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-1.5 text-[12.5px] text-[var(--fg)] transition-colors hover:bg-[var(--hover)]"
                  key={workspace.id}
                >
                  <input
                    type="checkbox"
                    className="accent-[var(--accent)]"
                    checked={selected.includes(workspace.id)}
                    onChange={(event) =>
                      setSelected((current) =>
                        event.target.checked
                          ? [...current, workspace.id]
                          : current.filter((id) => id !== workspace.id),
                      )
                    }
                  />
                  <span>{workspace.name}</span>
                </label>
              ))}
            </div>
          </SettingBlock>

          {state?.claims.map((claim) => (
            <SettingItem
              key={claim.id}
              title={claim.name}
              description={`请求编号 ${claim.id.slice(0, 8)}`}
            >
              <Button
                variant="destructive"
                size="sm"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    workbench.call(`/devices/${claim.id}/approve`, {
                      deny: true,
                    }),
                  )
                }
              >
                拒绝
              </Button>
              <Button
                size="sm"
                disabled={busy || !selected.length}
                onClick={() =>
                  void run(() =>
                    workbench.call(`/devices/${claim.id}/approve`, {
                      role,
                      workspaces: selected,
                    }),
                  )
                }
              >
                确认并授权设备
              </Button>
            </SettingItem>
          ))}
        </SettingSection>
      )}

      {(state?.devices ?? []).length > 0 && (
        <SettingSection title="已配对设备">
          {(state?.devices ?? []).map((device, index) => {
            const presentation = devicePresentation(
              device,
              workbench.workspaces,
            );
            return (
              <SettingBlock
                key={presentation.id ?? `invalid-${index}`}
                className="space-y-2"
              >
                <article
                  aria-label={`设备 ${presentation.name}`}
                  className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Smartphone
                        size={15}
                        className="text-[var(--ink-secondary)]"
                      />
                      <strong className="text-[13.5px] font-semibold text-[var(--fg)]">
                        {presentation.name}
                      </strong>
                      <Badge variant="outline">{presentation.role}</Badge>
                      <Badge
                        variant={
                          presentation.status === "invalid" ||
                          presentation.status === "revoked"
                            ? "destructive"
                            : "success"
                        }
                      >
                        {presentation.label}
                      </Badge>
                    </div>
                    <p className="m-0 text-[12px] text-[var(--muted)]">
                      {presentation.expires
                        ? `有效期至 ${presentation.expires}`
                        : "未提供有效到期时间"}
                    </p>
                    <p className="m-0 text-[12px] text-[var(--ink-secondary)] [overflow-wrap:anywhere]">
                      授权工作区：
                      {presentation.scopes.length
                        ? presentation.scopes.join("、")
                        : "未授权工作区"}
                    </p>
                    {presentation.status === "invalid" && (
                      <Alert variant="warning" role="status" className="mt-2">
                        授权记录不完整或格式异常，不能用于连接。请撤销后重新配对。
                      </Alert>
                    )}
                    {!presentation.id && (
                      <p className="m-0 text-[12px] text-[var(--muted)]">
                        缺少有效设备标识，无法通过此记录撤销。
                      </p>
                    )}
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={
                      busy ||
                      presentation.status === "revoked" ||
                      !presentation.id
                    }
                    onClick={() =>
                      void run(() =>
                        workbench.call(
                          `/devices/${encodeURIComponent(presentation.id ?? "")}/revoke`,
                          {},
                        ),
                      )
                    }
                  >
                    撤销设备
                  </Button>
                </article>
              </SettingBlock>
            );
          })}
        </SettingSection>
      )}

      {statusError && (
        <Alert variant="destructive" role="alert">
          {statusError}
        </Alert>
      )}
      {error && (
        <Alert variant="destructive" role="alert">
          {error}
        </Alert>
      )}
    </section>
  );
}

export function PhoneGate({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<"checking" | "pairing" | "connected">(
    "checking",
  );
  const [code, setCode] = useState("");
  const [name, setName] = useState("我的手机");
  const [claim, setClaim] = useState<{ id: string; secret: string } | null>(
    () => {
      try {
        return JSON.parse(
          sessionStorage.getItem("vibeone-pairing") || "null",
        ) as { id: string; secret: string } | null;
      } catch {
        return null;
      }
    },
  );
  const [error, setError] = useState("");

  useEffect(() => {
    document.documentElement.classList.add("phone-mode");
    void fetch("/v1/snapshot", { credentials: "include" })
      .then((response) => setPhase(response.ok ? "connected" : "pairing"))
      .catch(() => setPhase("pairing"));
    const unpaired = () => {
      setClaim(null);
      setPhase("pairing");
      setError("设备未授权、已过期或已撤销，请重新配对。");
    };
    window.addEventListener("vibeone-unpaired", unpaired);
    return () => window.removeEventListener("vibeone-unpaired", unpaired);
  }, []);

  async function call<T = Record<string, unknown>>(
    path: string,
    body: unknown,
  ): Promise<T> {
    const response = await fetch(`/v1/pairing/${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = (await response.json()) as { error?: string } & T;
    if (!response.ok) {
      throw new Error(result.error ?? "配对失败");
    }
    return result;
  }

  useEffect(() => {
    if (!claim || phase === "connected") {
      return;
    }
    let active = true;
    const timer = setInterval(
      () =>
        void call<{ status: string }>("poll", claim)
          .then((result) => {
            if (!active) {
              return;
            }
            if (result.status === "approved") {
              setPhase("connected");
              setClaim(null);
              sessionStorage.removeItem("vibeone-pairing");
            } else if (result.status === "denied") {
              setClaim(null);
              setError("电脑已拒绝此设备的配对请求。");
            }
          })
          .catch((err) => {
            if (active) {
              setError(err instanceof Error ? err.message : String(err));
              setClaim(null);
            }
          }),
      1200,
    );
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [claim, phase]);

  if (phase === "connected") {
    return <>{children}</>;
  }

  return (
    <main className="phone-pairing flex min-h-dvh items-center justify-center bg-[var(--bg)] p-6">
      <Card className="w-full max-w-md border border-[var(--line)]">
        <CardHeader>
          <CardTitle className="text-[20px]">VibeOne</CardTitle>
          <p className="m-0 text-[13px] text-[var(--muted)]">连接工作主机</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {phase === "checking" ? (
            <p role="status" className="m-0 text-[13px] text-[var(--ink-secondary)]">
              正在检查设备授权…
            </p>
          ) : claim ? (
            <div className="space-y-4">
              <Alert variant="info" role="status">
                等待电脑确认设备与工作区权限。请核对请求编号：
                {claim.id.slice(0, 8)}
              </Alert>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  setClaim(null);
                  sessionStorage.removeItem("vibeone-pairing");
                }}
              >
                重新配对
              </Button>
            </div>
          ) : (
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                setError("");
                const secret = crypto.randomUUID() + crypto.randomUUID();
                void call<{ id: string }>("claim", { code, name, secret })
                  .then((result) => {
                    const nextClaim = { id: result.id, secret };
                    setClaim(nextClaim);
                    sessionStorage.setItem(
                      "vibeone-pairing",
                      JSON.stringify(nextClaim),
                    );
                  })
                  .catch((err) =>
                    setError(err instanceof Error ? err.message : String(err)),
                  );
              }}
            >
              <label className="space-y-1.5 text-[12.5px] font-medium text-[var(--fg)]">
                <span>设备名称</span>
                <Input
                  value={name}
                  maxLength={80}
                  required
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label className="space-y-1.5 text-[12.5px] font-medium text-[var(--fg)]">
                <span>电脑上的配对码</span>
                <Input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  pattern="[0-9]{8}"
                  maxLength={8}
                  required
                  className="font-mono tracking-widest"
                  onChange={(event) => setCode(event.target.value)}
                />
              </label>
              <Button type="submit" className="w-full">
                请求配对
              </Button>
            </form>
          )}
          {error && (
            <Alert variant="destructive" role="alert">
              {error}
            </Alert>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
