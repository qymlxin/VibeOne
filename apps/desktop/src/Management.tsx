import React, { useState } from "react";
import { Copy } from "lucide-react";
import {
  removeProfile as removeProfileCommand,
  saveProfile as saveProfileCommand,
  type ProfileView,
} from "@vibeone/client-contracts";
import { chooseWorkspace } from "./api.ts";
import { Alert } from "./components/ui/alert.tsx";
import { Button } from "./components/ui/button.tsx";
import { Input } from "./components/ui/input.tsx";
import { Select } from "./components/ui/select.tsx";
import {
  SettingBlock,
  SettingItem,
  SettingSection,
} from "./components/ui/setting-layout.tsx";
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
        <SettingSection title="工作区">
          <SettingBlock>
            <form
              className="flex flex-col gap-3"
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
              <label className="space-y-1.5 text-[12.5px] font-medium text-[var(--fg)]">
                <span>工作区目录</span>
                <Input
                  aria-label="工作区目录"
                  placeholder="粘贴现有工程的绝对路径"
                  value={workspacePath}
                  disabled={importing}
                  onChange={(event) => setWorkspacePath(event.target.value)}
                />
              </label>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
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
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={
                    importing ||
                    !workspacePath.trim() ||
                    workbench.phase !== "online"
                  }
                >
                  {importing ? "正在导入…" : "导入工作区"}
                </Button>
              </div>
            </form>
            {workspaceNotice && (
              <Alert variant="info" role="status" className="mt-3">
                {workspaceNotice}
              </Alert>
            )}
          </SettingBlock>
          {(workbench.workspaces ?? []).map((workspace) => (
            <SettingItem
              key={workspace.id}
              title={workspace.name}
              description={
                <code className="font-mono text-[11.5px]">{workspace.path}</code>
              }
            />
          ))}
        </SettingSection>
      )}

      {(section === "all" || section === "agents") && (
        <SettingSection
          title="Agent 配置"
          description="会话创建时固定配置版本；后续修改配置不改变已有会话。"
        >
          {(workbench.profiles ?? []).map((profile) => (
            <SettingItem
              key={profile.id}
              title={profile.name}
              description={`${profile.provider} · 修订 ${profile.revision}`}
            >
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditing(profile);
                  setName(profile.name);
                  setProvider(profile.provider);
                  setCommand(profile.command ?? "");
                  setArgs(profile.args ? JSON.stringify(profile.args) : "");
                }}
              >
                编辑
              </Button>
              <Button
                variant="destructive"
                size="sm"
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
              </Button>
            </SettingItem>
          ))}
          <SettingBlock>
            <form
              className="flex flex-col gap-3.5"
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
              <label className="space-y-1.5 text-[12.5px] font-medium text-[var(--fg)]">
                <span>配置名称</span>
                <Input
                  required
                  maxLength={80}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label className="space-y-1.5 text-[12.5px] font-medium text-[var(--fg)]">
                <span>Agent</span>
                <Select
                  wrapperClassName="w-full"
                  value={provider}
                  onChange={(event) => setProvider(event.target.value)}
                >
                  {workbench.providers.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="space-y-1.5 text-[12.5px] font-medium text-[var(--fg)]">
                <span>自定义 ACP 启动程序（可选）</span>
                <Input
                  placeholder="可执行程序的绝对路径"
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                />
              </label>
              <label className="space-y-1.5 text-[12.5px] font-medium text-[var(--fg)]">
                <span>完整启动参数（可选，JSON 数组；填写后覆盖默认值）</span>
                <Input
                  placeholder={'["/path/to/bridge.js"]'}
                  value={args}
                  onChange={(event) => setArgs(event.target.value)}
                />
              </label>
              <div className="flex flex-wrap justify-end gap-2 pt-1">
                {editing && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditing(null);
                      setName("");
                      setCommand("");
                      setArgs("");
                    }}
                  >
                    取消编辑
                  </Button>
                )}
                <Button type="submit" size="sm">
                  {editing ? "保存修订" : "保存配置"}
                </Button>
              </div>
            </form>
          </SettingBlock>
        </SettingSection>
      )}

      {(section === "all" || section === "notifications") && (
        <SettingSection title="本机通知">
          <SettingItem
            title="开启审批与执行结束通知"
            description="在有待审批命令或会话结束时通过桌面通知提醒。"
          >
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void run(async () => {
                  await enableNotifications();
                })
              }
            >
              开启审批与执行结束通知
            </Button>
          </SettingItem>
        </SettingSection>
      )}

      {(section === "all" || section === "diagnostics") && (
        <SettingSection title="诊断">
          <SettingItem
            title="脱敏运行诊断"
            description="导出不含凭据与敏感信息的当前主机与会话诊断快照，便于问题定位。"
          >
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void run(async () =>
                  setDiagnostics(await workbench.call("/diagnostics")),
                )
              }
            >
              生成脱敏诊断
            </Button>
          </SettingItem>
          {diagnostics !== null && diagnostics !== undefined && (
            <SettingBlock className="space-y-3 bg-[color-mix(in_srgb,var(--bg)_65%,var(--surface))]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-medium text-[var(--ink-secondary)]">
                  诊断输出快照
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void run(() =>
                      navigator.clipboard.writeText(
                        JSON.stringify(diagnostics, null, 2),
                      ),
                    )
                  }
                >
                  <Copy size={13} />
                  复制诊断
                </Button>
              </div>
              <pre className="m-0 max-h-[260px] overflow-auto rounded-lg border border-[var(--line)] bg-[var(--bg)] p-3 font-mono text-[11.5px] leading-relaxed text-[var(--ink-secondary)] whitespace-pre-wrap [overflow-wrap:anywhere]">
                {JSON.stringify(diagnostics, null, 2)}
              </pre>
            </SettingBlock>
          )}
        </SettingSection>
      )}

      {error && (
        <Alert variant="destructive" role="alert" className="mt-4">
          {error}
        </Alert>
      )}
    </>
  );
}
