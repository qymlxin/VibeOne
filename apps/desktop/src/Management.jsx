import React, { useState } from "react";
import { enableNotifications } from "./notifications.js";
import { chooseWorkspace } from "./api.js";
import {saveProfile as saveProfileCommand,removeProfile as removeProfileCommand} from "@vibeone/client-contracts";

export function Management({ workbench, section="all" }) {
  const [error, setError] = useState(""),
    [name, setName] = useState(""),
    [editing, setEditing] = useState(null),
    [provider, setProvider] = useState("demo"),
    [command, setCommand] = useState(""),
    [args, setArgs] = useState(""),
    [diagnostics, setDiagnostics] = useState(null),
    [workspacePath,setWorkspacePath] = useState(''),
    [importing,setImporting] = useState(false),
    [workspaceNotice,setWorkspaceNotice] = useState('');
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
      {(section==='all'||section==='workspaces') && <section className="desktop-settings-group"><h2>工作区</h2>
      <form className="desktop-management-form" onSubmit={async event=>{
        event.preventDefault();if(importing||workbench.phase!=='online')return;
        const path=workspacePath.trim();setWorkspaceNotice('');
        if(!/^(\/|[A-Za-z]:[\\/]|\\\\)/.test(path)){setError('请输入工作区的绝对路径。');return;}
        setImporting(true);
        try{const result=await run(()=>workbench.call('/workspaces',{path}));if(result){setWorkspaceNotice(`已导入工作区：${result.name}`);setWorkspacePath('');}}
        finally{setImporting(false);}
      }}>
      <label>工作区目录<input aria-label="工作区目录" placeholder="粘贴现有工程的绝对路径" value={workspacePath} disabled={importing} onChange={event=>setWorkspacePath(event.target.value)}/></label>
      <button
        type="button"
        className="desktop-button"
        disabled={importing}
        onClick={() =>
          void run(async () => {
            const path = await chooseWorkspace();
            if (path) setWorkspacePath(path);
          })
        }
      >
        选择目录
      </button>
      <button type="submit" className="desktop-button" disabled={importing||!workspacePath.trim()||workbench.phase!=='online'}>{importing?'正在导入…':'导入工作区'}</button>
      </form>
      {workspaceNotice&&<p role="status">{workspaceNotice}</p>}
      {(workbench.workspaces ?? []).map((workspace) => (
        <p key={workspace.id}>
          {workspace.name} · {workspace.path}
        </p>
      ))}
      </section>}
      {(section==='all'||section==='agents') && <section className="desktop-settings-group"><h2>Agent 配置</h2>
      <p>会话创建时固定配置版本；后续修改配置不改变已有会话。</p>
      {(workbench.profiles ?? []).map((profile) => (
        <p key={profile.id}>
          {profile.name} · {profile.provider} · 修订 {profile.revision}
          <button
            onClick={() => {
              setEditing(profile);
              setName(profile.name);
              setProvider(profile.provider);
              setCommand(profile.command ?? "");
              setArgs(profile.args ? JSON.stringify(profile.args) : "");
            }}
          >
            编辑
          </button>
          <button
            onClick={() =>
              void run(() =>
                workbench.call(...removeProfileCommand(profile.id,profile.revision)),
              )
            }
          >
            移除配置
          </button>
        </p>
      ))}
      <form
        className="desktop-management-form"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            await workbench.call(...saveProfileCommand({
              name,
              provider,
              ...(editing
                ? { id: editing.id, revision: editing.revision }
                : {}),
              ...(command.trim() ? { command: command.trim() } : {}),
              ...(args.trim() ? { args: JSON.parse(args) } : {}),
            }));
            setName("");
            setCommand("");
            setArgs("");
            setEditing(null);
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
          完整启动参数（可选，JSON 数组；填写后覆盖默认值）
          <input
            placeholder={'["/path/to/bridge.js"]'}
            value={args}
            onChange={(event) => setArgs(event.target.value)}
          />
        </label>
        <button className="desktop-button">
          {editing ? "保存修订" : "保存配置"}
        </button>
        {editing && (
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setName("");
              setCommand("");
              setArgs("");
            }}
          >
            取消编辑
          </button>
        )}
      </form>
      </section>}
      {(section==='all'||section==='notifications') && <section className="desktop-settings-group"><h2>本机通知</h2>
      <button
        className="desktop-button"
        onClick={() =>
          void run(async () => {
            await enableNotifications();
          })
        }
      >
        开启审批与执行结束通知
      </button>
      </section>}
      {(section==='all'||section==='diagnostics') && <section className="desktop-settings-group"><h2>诊断</h2>
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
      </section>}
      {error && <p role="alert">{error}</p>}
    </>
  );
}
