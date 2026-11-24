import React, { useCallback, useEffect, useRef, useState } from "react";
import type { RemoteStatusResponse } from "@vibeone/client-contracts";
import { exportRemoteCertificate } from "./api.ts";
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
    <section className="desktop-remote-settings">
      <p>通过局域网或已有可信网络连接。首次配对需先在手机信任主机证书。</p>
      {state?.configuration?.enabled && !state.url && (
        <p role="status">
          配置已保存为开启，但当前入口未运行。请核对 IP 和端口后重新开启。
        </p>
      )}
      <section className="desktop-settings-section">
        <h2>手机入口</h2>
        <div className="desktop-settings-card">
          <div className="desktop-settings-row">
            <div>
              <strong>HTTPS 远程访问</strong>
              <p>使用局域网或已有可信网络，不自动建立公网隧道。</p>
            </div>
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
          </div>
          <label className="desktop-settings-row desktop-remote-field">
            <span>主机 IP</span>
            <input
              value={ip}
              aria-label="远程入口 IP"
              onChange={(event) => {
                dirty.current = true;
                setIp(event.target.value);
              }}
              disabled={busy || !state || Boolean(state.url)}
            />
          </label>
          <label className="desktop-settings-row desktop-remote-field">
            <span>
              端口 <small>0 表示自动选择</small>
            </span>
            <input
              type="number"
              min="0"
              max="65535"
              value={port}
              aria-label="远程入口端口"
              onChange={(event) => {
                dirty.current = true;
                setPort(event.target.value);
              }}
              disabled={busy || !state || Boolean(state.url)}
            />
          </label>
          {state?.url && (
            <div className="desktop-settings-row">
              <span>连接地址</span>
              <a href={state.url} target="_blank" rel="noopener noreferrer">
                {state.url}
              </a>
              <button
                onClick={() =>
                  void run(() => navigator.clipboard.writeText(state.url ?? ""))
                }
              >
                复制地址
              </button>
            </div>
          )}
        </div>
      </section>
      {state?.url && (
        <section className="desktop-settings-section">
          <h2>首次配对</h2>
          <div className="desktop-settings-card">
            <div className="desktop-settings-row">
              <div>
                <strong>信任主机证书</strong>
                <p>在手机安装并信任此主机的 CA 证书，再打开 HTTPS 地址。</p>
              </div>
              <button onClick={() => void run(exportRemoteCertificate)}>
                导出 CA 证书
              </button>
            </div>
            <div className="desktop-settings-row">
              <span>证书文件</span>
              <code className="desktop-remote-certificate">
                {state.certificatePath}
              </code>
            </div>
            <div className="desktop-settings-row">
              <div>
                <strong>短期配对码</strong>
                <p>配对码有效期为 5 分钟，设备还需在电脑端确认授权。</p>
              </div>
              <button
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
                生成 5 分钟配对码
              </button>
            </div>
            {code && (
              <div className="desktop-settings-row">
                <span>配对码</span>
                <p>
                  配对码：<strong>{code.code}</strong> · 截止{" "}
                  {new Date(code.expiresAt * 1000).toLocaleTimeString()}
                </p>
              </div>
            )}
            {qrSvg && (
              <div className="desktop-remote-qr-row">
                <img
                  className="desktop-remote-qr"
                  alt="手机入口二维码"
                  src={`data:image/svg+xml,${encodeURIComponent(qrSvg)}`}
                />
                <p>
                  手机信任证书后扫码，输入短期配对码，再回到电脑确认设备权限。
                </p>
              </div>
            )}
          </div>
        </section>
      )}
      {Boolean(state?.claims?.length) && (
        <>
          <h3>待确认的设备</h3>
          <label>
            设备权限
            <select
              value={role}
              onChange={(event) => setRole(event.target.value)}
            >
              <option value="viewer">仅查看</option>
              <option value="approver">查看与审批</option>
              <option value="operator">查看、操作与审批</option>
            </select>
          </label>
          {(workbench.workspaces ?? []).map((workspace) => (
            <label className="desktop-device-scope" key={workspace.id}>
              <input
                type="checkbox"
                checked={selected.includes(workspace.id)}
                onChange={(event) =>
                  setSelected((current) =>
                    event.target.checked
                      ? [...current, workspace.id]
                      : current.filter((id) => id !== workspace.id),
                  )
                }
              />
              {workspace.name}
            </label>
          ))}
          {state?.claims.map((claim) => (
            <article key={claim.id}>
              <strong>
                {claim.name} · 编号 {claim.id.slice(0, 8)}
              </strong>
              <button
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
              </button>
              <button
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
              </button>
            </article>
          ))}
        </>
      )}
      {(state?.devices ?? []).map((device, index) => {
        const presentation = devicePresentation(device, workbench.workspaces);
        return (
          <article
            className="desktop-plugin-card"
            key={presentation.id ?? `invalid-${index}`}
            aria-label={`设备 ${presentation.name}`}
          >
            <strong>{presentation.name}</strong> · {presentation.role} ·{" "}
            {presentation.label}
            <p>
              {presentation.expires
                ? `有效期至 ${presentation.expires}`
                : "未提供有效到期时间"}
            </p>
            <p style={{ overflowWrap: "anywhere" }}>
              授权工作区：
              {presentation.scopes.length
                ? presentation.scopes.join("、")
                : "未授权工作区"}
            </p>
            {presentation.status === "invalid" && (
              <p role="status">
                授权记录不完整或格式异常，不能用于连接。请撤销后重新配对。
              </p>
            )}
            {!presentation.id && (
              <p>缺少有效设备标识，无法通过此记录撤销。</p>
            )}
            <button
              disabled={
                busy || presentation.status === "revoked" || !presentation.id
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
            </button>
          </article>
        );
      })}
      {statusError && <p role="alert">{statusError}</p>}
      {error && <p role="alert">{error}</p>}
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
    <main className="phone-pairing">
      <h1>VibeOne</h1>
      <p>连接工作主机</p>
      {phase === "checking" ? (
        <p role="status">正在检查设备授权…</p>
      ) : claim ? (
        <>
          <p role="status">
            等待电脑确认设备与工作区权限。请核对请求编号：
            {claim.id.slice(0, 8)}
          </p>
          <button
            onClick={() => {
              setClaim(null);
              sessionStorage.removeItem("vibeone-pairing");
            }}
          >
            重新配对
          </button>
        </>
      ) : (
        <form
          className="desktop-management-form"
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
          <label>
            设备名称
            <input
              value={name}
              maxLength={80}
              required
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            电脑上的配对码
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              pattern="[0-9]{8}"
              maxLength={8}
              required
              onChange={(event) => setCode(event.target.value)}
            />
          </label>
          <button className="desktop-button primary">请求配对</button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
