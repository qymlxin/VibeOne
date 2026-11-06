import React, { useCallback, useEffect, useRef, useState } from "react";
import { remotePreferences } from "./remote-preferences.js";
import { exportRemoteCertificate } from "./api.js";

export function RemoteSettings({ workbench }) {
  const [state, setState] = useState(null),
    [ip, setIp] = useState(""),
    [port, setPort] = useState("0"),
    [code, setCode] = useState(null),
    [qr, setQr] = useState(null),
    [role, setRole] = useState("operator"),
    [selected, setSelected] = useState([]),
    [error, setError] = useState(""),
    [statusError, setStatusError] = useState(""),
    [busy, setBusy] = useState(false);
  const dirty=useRef(false), request=useRef(0), mounted=useRef(false);
  const refresh=useCallback(async (confirmed=false) => {
    const id=++request.current;
    const value=await workbench.call("/devices");
    if(!mounted.current||id!==request.current)return;
    setState(value);
    if(confirmed||!dirty.current){
      const preferences=remotePreferences(value);
      setIp(preferences.ip);setPort(preferences.port);dirty.current=false;
    }
  },[workbench.call]);
  useEffect(() => {
    mounted.current=true;
    const poll=()=>void refresh().then(()=>{if(mounted.current)setStatusError("");}).catch(error=>{if(mounted.current)setStatusError(`远程状态读取失败：${error.message??error}`);});
    poll();
    const timer=setInterval(poll,3000);
    return()=>{mounted.current=false;++request.current;clearInterval(timer);};
  }, [refresh]);
  async function run(action, confirmConfiguration=false) {
    setBusy(true);
    setError("");
    try {
      await action();
      await refresh(confirmConfiguration);
    } catch (error) {
      setError(error.message ?? String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h2>手机远程控制</h2>
      <p>
        通过局域网或已有可信网络连接。首次使用需将此主机的 CA
        证书安装并设为受信任，再在手机浏览器打开 HTTPS 地址。
      </p>
      {state?.configuration?.enabled&&!state.url&&<p role="status">配置已保存为开启，但当前入口未运行。请核对 IP 和端口后重新开启。</p>}
      <div className="desktop-management-form">
        <label>
          本机局域网 / 可信网络 IP
          <input
            value={ip}
            aria-label="远程入口 IP"
            onChange={(event) => {dirty.current=true;setIp(event.target.value);}}
            disabled={busy || !state || !!state.url}
          />
        </label>
        <label>
          端口（0 表示自动选择）
          <input
            type="number"
            min="0"
            max="65535"
            value={port}
            aria-label="远程入口端口"
            onChange={(event) => {dirty.current=true;setPort(event.target.value);}}
            disabled={busy || !state || !!state.url}
          />
        </label>
        <button
          disabled={busy || !state || !!state.url || !ip || !/^\d+$/.test(port) || Number(port)>65535}
          onClick={() =>
            void run(async () => {
              const result = await workbench.call("/remote", {
                enabled: true,
                ip,
                port: Number(port),
              });
              setQr(result.qr);
            }, true)
          }
        >
          开启 HTTPS 手机入口
        </button>
        {state?.url && (
          <>
            <p>
              连接地址：
              <a href={state.url} target="_blank" rel="noopener noreferrer">
                {state.url}
              </a>
            </p>
            <button
              onClick={() =>
                void run(() => navigator.clipboard.writeText(state.url))
              }
            >
              复制地址
            </button>
            <button onClick={() => void run(exportRemoteCertificate)}>
              导出 CA 证书
            </button>
            <p>证书文件：{state.certificatePath}</p>
            {qr && (
              <img
                className="desktop-remote-qr"
                alt="手机入口二维码"
                src={`data:image/svg+xml,${encodeURIComponent(qr)}`}
              />
            )}
            <button
              disabled={busy}
              onClick={() =>
                void run(async () =>
                  setCode(await workbench.call("/pairing/code", {})),
                )
              }
            >
              生成 5 分钟配对码
            </button>
            {code && (
              <p>
                配对码：<strong>{code.code}</strong> · 截止{" "}
                {new Date(code.expiresAt * 1000).toLocaleTimeString()}
              </p>
            )}
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await workbench.call("/remote", { enabled: false });
                  setCode(null);
                  setQr(null);
                }, true)
              }
            >
              关闭手机入口
            </button>
          </>
        )}
      </div>
      {!!state?.claims?.length && (
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
          {state.claims.map((claim) => (
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
      {(state?.devices ?? []).map((device) => (
        <article className="desktop-plugin-card" key={device.id}>
          <strong>{device.name}</strong> · {device.role} ·{" "}
          {device.revoked ? "已撤销" : "已授权"}
          <p>
            有效期至 {new Date(device.expiresAt * 1000).toLocaleDateString()}
          </p>
          <button
            disabled={busy || device.revoked}
            onClick={() =>
              void run(() => workbench.call(`/devices/${device.id}/revoke`, {}))
            }
          >
            撤销设备
          </button>
        </article>
      ))}
      {statusError && <p role="alert">{statusError}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

export function PhoneGate({ children }) {
  const [phase, setPhase] = useState("checking"),
    [code, setCode] = useState(""),
    [name, setName] = useState("我的手机"),
    [claim, setClaim] = useState(() => {
      try {
        return JSON.parse(sessionStorage.getItem("vibeone-pairing") || "null");
      } catch {
        return null;
      }
    }),
    [error, setError] = useState("");
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
  async function call(path, body) {
    const response = await fetch(`/v1/pairing/${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error ?? "配对失败");
    return result;
  }
  useEffect(() => {
    if (!claim || phase === "connected") return;
    let active = true;
    const timer = setInterval(
      () =>
        void call("poll", claim)
          .then((result) => {
            if (!active) return;
            if (result.status === "approved") {
              setPhase("connected");
              setClaim(null);
              sessionStorage.removeItem("vibeone-pairing");
            } else if (result.status === "denied") {
              setClaim(null);
              setError("电脑已拒绝此设备的配对请求。");
            }
          })
          .catch((error) => {
            if (active) {
              setError(error.message);
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
  if (phase === "connected") return children;
  return (
    <main className="phone-pairing">
      <h1>VibeOne</h1>
      <p>连接工作主机</p>
      {phase === "checking" ? (
        <p role="status">正在检查设备授权…</p>
      ) : claim ? (
        <>
          <p role="status">
            等待电脑确认设备与工作区权限。请核对请求编号：{claim.id.slice(0, 8)}
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
            void call("claim", { code, name, secret })
              .then((result) => {
                const claim = { id: result.id, secret };
                setClaim(claim);
                sessionStorage.setItem(
                  "vibeone-pairing",
                  JSON.stringify(claim),
                );
              })
              .catch((error) => setError(error.message));
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
