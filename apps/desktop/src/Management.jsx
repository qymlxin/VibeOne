import React, { useState } from "react";
import { chooseWorkspace } from "./api.js";

export function Management({ workbench }) {
  const [error, setError] = useState(""),
    [name, setName] = useState(""),
    [provider, setProvider] = useState("demo"),
    [command, setCommand] = useState(""),
    [args, setArgs] = useState(""),
    [diagnostics, setDiagnostics] = useState(null);
  async function run(action) {
    setError("");
    try {
      return await action();
    } catch (error) {
      setError(error.message ?? String(error));
    }
  }
  return (
    <>
      <h2>工作区</h2>
      <button
        className="desktop-button"
        onClick={() =>
          void run(async () => {
            const path = await chooseWorkspace();
            if (path) await workbench.call("/workspaces", { path });
          })
        }
      >
        导入工作区
      </button>
      {(workbench.workspaces ?? []).map((workspace) => (
        <p key={workspace.id}>
          {workspace.name} · {workspace.path}
        </p>
      ))}
      <h2>Agent 配置</h2>
      <p>会话创建时固定配置版本；后续修改配置不改变已有会话。</p>
      {(workbench.profiles ?? []).map((profile) => (
        <p key={profile.id}>
          {profile.name} · {profile.provider} · 修订 {profile.revision}
        </p>
      ))}
      <form
        className="desktop-management-form"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            await workbench.call("/profiles", {
              name,
              provider,
              ...(command.trim() ? { command: command.trim() } : {}),
              ...(args.trim() ? { args: JSON.parse(args) } : {}),
            });
            setName("");
            setCommand("");
            setArgs("");
          });
        }}
      >
        <label>
          配置名称
          <input
            required
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          Agent
          <select
            value={provider}
            onChange={(event) => setProvider(event.target.value)}
          >
            {workbench.providers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          自定义 ACP 启动程序（可选）
          <input
            placeholder="可执行程序的绝对路径"
            value={command}
            onChange={(event) => setCommand(event.target.value)}
          />
        </label>
        <label>
          启动参数（可选，JSON 数组）
          <input
            placeholder={'["/path/to/bridge.js"]'}
            value={args}
            onChange={(event) => setArgs(event.target.value)}
          />
        </label>
        <button className="desktop-button">保存配置</button>
      </form>
      <h2>本机通知</h2>
      <button
        className="desktop-button"
        onClick={() =>
          void run(async () => {
            if (!("Notification" in window))
              throw Error(
                "当前系统 WebView 不支持网页通知；请使用工作台待处理列表。",
              );
            const status = await Notification.requestPermission();
            if (status !== "granted") throw Error("通知权限未开启");
          })
        }
      >
        开启审批与执行结束通知
      </button>
      <h2>诊断</h2>
      <button
        className="desktop-button"
        onClick={() =>
          void run(async () =>
            setDiagnostics(await workbench.call("/diagnostics")),
          )
        }
      >
        生成脱敏诊断
      </button>
      {diagnostics && (
        <>
          <pre className="desktop-diagnostic">
            {JSON.stringify(diagnostics, null, 2)}
          </pre>
          <button
            onClick={() =>
              void run(() =>
                navigator.clipboard.writeText(
                  JSON.stringify(diagnostics, null, 2),
                ),
              )
            }
          >
            复制诊断
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </>
  );
}
