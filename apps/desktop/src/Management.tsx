import React, { useState } from "react";
import {
  removeProfile as removeProfileCommand,
  saveProfile as saveProfileCommand,
  type ProfileView,
} from "@vibeone/client-contracts";
import { chooseWorkspace } from "./api.ts";
import { enableNotifications } from "./notifications.ts";
import { useProfileCommands } from "./use-profile-commands.ts";
import type { WorkbenchLike } from "./types.ts";

export function Management({
  workbench,
  section = "all",
}: {
  workbench: WorkbenchLike;
  section?: "all" | "workspaces" | "agents" | "notifications" | "diagnostics";
}) {
  const profileCommands = useProfileCommands(workbench);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<ProfileView | null>(null);
  const [provider, setProvider] = useState("demo");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [diagnostics, setDiagnostics] = useState<unknown>(null);
  const [workspacePath, setWorkspacePath] = useState("");
  const [importing, setImporting] = useState(false);
  const [workspaceNotice, setWorkspaceNotice] = useState("");

  async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
    setError("");
    try {
      return await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return undefined;
    }
  }

  return (
    <>
      {(section === "all" || section === "workspaces") && (
        <section className="settings-group desktop-settings-group">
          <h2>工作区</h2>
          <div className="settings-rows">
            <form
              className="settings-form desktop-management-form"
              onSubmit={async (event) => {
                event.preventDefault();
                if (importing || workbench.phase !== "online") {
                  return;
                }
                const path = workspacePath.trim();
                setWorkspaceNotice("");
                if (!/^(\/|[A-Za-z]:[\\/]|\\\\)/.test(path)) {
                  setError("请输入工作区的绝对路径。");
                  return;
                }
                setImporting(true);
                try {
                  const result = await run(() =>
                    workbench.call<{ name: string }>("/workspaces", { path }),
                  );
                  if (result) {
                    setWorkspaceNotice(`已导入工作区：${result.name}`);
                    setWorkspacePath("");
                  }
                } finally {
                  setImporting(false);
                }
              }}
            >
              <label>
                工作区目录
                <input
                  aria-label="工作区目录"
                  placeholder="粘贴现有工程的绝对路径"
                  value={workspacePath}
                  disabled={importing}
                  onChange={(event) => setWorkspacePath(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="desktop-button"
                disabled={importing}
                onClick={() =>
                  void run(async () => {
                    const chosen = await chooseWorkspace();
                    if (chosen) {
                      setWorkspacePath(chosen);
                    }
                  })
                }
              >
                选择目录
              </button>
              <button
                type="submit"
                className="desktop-button"
                disabled={
                  importing ||
                  !workspacePath.trim() ||
                  workbench.phase !== "online"
                }
              >
                {importing ? "正在导入…" : "导入工作区"}
              </button>
            </form>
            {workspaceNotice && <p role="status">{workspaceNotice}</p>}
            {(workbench.workspaces ?? []).map((workspace) => (
              <p key={workspace.id}>
                {workspace.name} · {workspace.path}
              </p>
            ))}
          </div>
        </section>
      )}
      {(section === "all" || section === "agents") && (
        <section className="settings-group desktop-settings-group">
          <h2>Agent 配置</h2>
          <div className="settings-rows">
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
                    setArgs(
                      profile.args ? JSON.stringify(profile.args) : "",
                    );
                  }}
                >
                  编辑
                </button>
                <button
                  onClick={() =>
                    void run(() =>
                      profileCommands.call(
                        removeProfileCommand(
                          profile.id,
                          profile.revision ?? undefined,
                        ),
                      ),
                    )
                  }
                >
                  移除配置
                </button>
              </p>
            ))}
            <form
              className="settings-form desktop-management-form"
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  await profileCommands.call(
                    saveProfileCommand({
                      name,
                      provider,
                      ...(editing
                        ? {
                            id: editing.id,
                            revision: editing.revision ?? undefined,
                          }
                        : {}),
                      ...(command.trim() ? { command: command.trim() } : {}),
                      ...(args.trim()
                        ? { args: JSON.parse(args) as string[] }
                        : {}),
                    }),
                  );
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
          </div>
        </section>
      )}
      {(section === "all" || section === "notifications") && (
        <section className="settings-group desktop-settings-group">
          <h2>本机通知</h2>
          <div className="settings-rows">
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
          </div>
        </section>
      )}
      {(section === "all" || section === "diagnostics") && (
        <section className="settings-group desktop-settings-group">
          <h2>诊断</h2>
          <div className="settings-rows">
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
            {diagnostics !== null && diagnostics !== undefined && (
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
          </div>
        </section>
      )}
      {error && <p role="alert">{error}</p>}
    </>
  );
}
