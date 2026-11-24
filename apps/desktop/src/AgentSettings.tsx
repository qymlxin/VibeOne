import React, { useEffect, useRef, useState } from "react";
import { Plus, Terminal } from "lucide-react";
import {
  removeProfile,
  saveProfile,
  type ProfileIssue,
  type ProfileRecord,
  type ProfileView,
} from "@vibeone/client-contracts";
import { ProviderProbe } from "./ProviderProbe.tsx";
import { SettingsGroup, SettingsRow } from "./SettingsRows.tsx";
import { useProfileCommands } from "./use-profile-commands.ts";
import type { WorkbenchLike } from "./types.ts";

interface ProfileDraft {
  name: string;
  provider: string;
  command: string;
  args: string;
  revision: number | null;
}

const empty = (): ProfileDraft => ({
  name: "",
  provider: "demo",
  command: "",
  args: "",
  revision: null,
});

export function AgentSettings({ workbench }: { workbench: WorkbenchLike }) {
  const commands = useProfileCommands(workbench);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProfileDraft>(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [issueError, setIssueError] = useState("");
  const [issueNotice, setIssueNotice] = useState("");
  const [issueRetry, setIssueRetry] = useState<ProfileIssue | null>(null);
  const pending = useRef(false);
  const profiles = workbench.profiles ?? [];
  const issues = workbench.profileIssues ?? [];

  const select = (profile: ProfileView | null) => {
    commands.reset();
    setSelected(profile?.id ?? "new");
    setDraft(
      profile
        ? {
            name: profile.name,
            provider: profile.provider,
            command: profile.command ?? "",
            args: profile.args ? JSON.stringify(profile.args, null, 2) : "",
            revision: profile.revision ?? null,
          }
        : empty(),
    );
    setError("");
    setNotice("");
  };

  useEffect(() => {
    if (selected === null && profiles[0]) {
      select(profiles[0]);
    }
  }, [profiles, selected]);

  const provider = workbench.providers.find(
    (item) => item.id === draft.provider,
  );
  const offline = workbench.phase !== "online";
  const change = (patch: Partial<ProfileDraft>) => {
    setDraft((previous) => ({ ...previous, ...patch }));
    setNotice("");
  };

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (pending.current || offline) {
      return;
    }
    pending.current = true;
    setError("");
    setBusy(true);
    try {
      let args: string[] | undefined;
      if (draft.args.trim()) {
        const parsed = JSON.parse(draft.args) as unknown;
        if (
          !Array.isArray(parsed) ||
          !parsed.every((arg): arg is string => typeof arg === "string")
        ) {
          throw new Error("启动参数必须是字符串 JSON 数组。");
        }
        args = parsed;
      }
      if (
        draft.command.trim() &&
        !/^(\/|[A-Za-z]:[\\/])/.test(draft.command.trim())
      ) {
        throw new Error("自定义启动程序需要绝对路径。");
      }
      const result = (await commands.call(
        saveProfile({
          name: draft.name.trim(),
          provider: draft.provider,
          ...(selected && selected !== "new"
            ? {
                id: selected,
                ...(draft.revision == null ? {} : { revision: draft.revision }),
              }
            : {}),
          ...(draft.command.trim() ? { command: draft.command.trim() } : {}),
          ...(args ? { args } : {}),
        }),
      )) as Partial<ProfileRecord> | null;
      if (result?.id) {
        setSelected(result.id);
        setDraft({
          name: result.name ?? draft.name.trim(),
          provider: result.provider ?? draft.provider,
          command: result.command ?? "",
          args: result.args ? JSON.stringify(result.args, null, 2) : "",
          revision: result.revision ?? null,
        });
      } else {
        select(null);
      }
      setNotice("配置已保存。已有会话继续使用原修订，新建会话可使用新配置。");
    } catch (err) {
      setError(
        err instanceof SyntaxError
          ? "启动参数不是有效 JSON。"
          : err instanceof Error
            ? err.message
            : String(err),
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function remove() {
    if (pending.current || offline || !selected || selected === "new") {
      return;
    }
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await commands.call(
        removeProfile(selected, draft.revision ?? undefined),
      );
      select(null);
      setNotice("配置已移除，已有会话的历史配置保留。");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function removeIssue(issue: ProfileIssue) {
    if (pending.current || offline) {
      return;
    }
    pending.current = true;
    setBusy(true);
    setIssueError("");
    setIssueNotice("");
    try {
      await commands.call(
        removeProfile(
          issue.id,
          issue.revision ?? undefined,
          issue.recordHash,
        ),
      );
      setIssueRetry(null);
      setIssueNotice("异常配置已移除，已有会话保持不变。");
    } catch (err) {
      setIssueError(err instanceof Error ? err.message : String(err));
      setIssueRetry(issue);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  const savedProfile = profiles.find((item) => item.id === selected);
  const probeDirty = savedProfile
    ? draft.provider !== savedProfile.provider ||
      draft.command !== (savedProfile.command ?? "") ||
      draft.args !==
        (savedProfile.args ? JSON.stringify(savedProfile.args, null, 2) : "")
    : Boolean(draft.command || draft.args);

  return (
    <>
      {(issues.length > 0 || issueError || issueNotice) && (
        <section
          className="desktop-settings-group"
          aria-label="需要检查的配置"
        >
          <h2>需要检查的配置</h2>
          <p>
            以下记录未加入可用配置。原始内容仍保留在本地，不影响其他配置和会话。
          </p>
          {issues.map((issue) => (
            <div key={issue.id} className="desktop-settings-row">
              <div>
                <code style={{ overflowWrap: "anywhere" }}>{issue.id}</code>
                <p>{issue.error}</p>
              </div>
              <button
                disabled={busy || offline}
                aria-label={`移除异常配置 ${issue.id}`}
                onClick={() => void removeIssue(issue)}
              >
                移除异常配置
              </button>
            </div>
          ))}
          {issueError && (
            <p role="alert">
              {issueError}
              {issueRetry && (
                <button
                  disabled={busy || offline}
                  onClick={() => void removeIssue(issueRetry)}
                >
                  重试移除异常配置
                </button>
              )}
            </p>
          )}
          {issueNotice && <p role="status">{issueNotice}</p>}
        </section>
      )}
      <div className="settings-master-detail desktop-settings-object-layout">
        <aside className="settings-object-list desktop-settings-object-list">
          <h2>
            启动配置
            <button
              aria-label="新建 Agent 配置"
              disabled={busy}
              onClick={() => select(null)}
            >
              <Plus size={14} />
            </button>
          </h2>
          {profiles.map((profile) => (
            <button
              key={profile.id}
              title={profile.name}
              disabled={busy}
              className={selected === profile.id ? "selected" : ""}
              onClick={() => select(profile)}
            >
              <Terminal size={16} />
              <span>
                <strong>{profile.name}</strong>
                <small>
                  {profile.provider} ·{" "}
                  {profile.revision == null
                    ? "旧版配置"
                    : `r${profile.revision}`}
                </small>
              </span>
            </button>
          ))}
          {!profiles.length && <p>尚未保存配置，选择 Agent 后创建。</p>}
        </aside>
        <section className="settings-object-detail desktop-settings-object-detail">
          <header className="object-heading desktop-settings-object-heading">
            <span className="provider-symbol desktop-provider-symbol large">
              <Terminal size={22} />
            </span>
            <div>
              <h2>
                {selected === "new" || selected === null
                  ? "新建配置"
                  : draft.name}
              </h2>
              <p>{provider?.description}</p>
            </div>
          </header>
          <div className="settings-inline-status desktop-settings-inline-status">
            <span className="settings-badge desktop-settings-badge">
              {provider?.available ? "启动入口可用" : "未找到启动入口"}
            </span>
            <span>认证由本机工具管理</span>
          </div>
          <SettingsGroup title="连接信息">
            <SettingsRow title="通信协议">
              <code>ACP v2</code>
            </SettingsRow>
            <SettingsRow
              title="认证状态"
              description="入口可用不代表已经认证。实际会话由 Agent 返回认证结果。"
            >
              <span>由实际工具返回</span>
            </SettingsRow>
          </SettingsGroup>
          <ProviderProbe
            key={JSON.stringify([
              selected,
              draft.provider,
              draft.command,
              draft.args,
              draft.revision,
            ])}
            workbench={workbench}
            provider={draft.provider}
            profileId={selected && selected !== "new" ? selected : undefined}
            dirty={probeDirty}
          />
          <form className="desktop-profile-form" onSubmit={save}>
            <SettingsGroup
              title="启动配置"
              description="保存后创建新修订；已有会话继续使用创建时的配置。"
            >
              <SettingsRow title="配置名称">
                <input
                  aria-label="配置名称"
                  required
                  maxLength={80}
                  value={draft.name}
                  onChange={(event) => change({ name: event.target.value })}
                />
              </SettingsRow>
              <SettingsRow title="Agent 类型">
                <select
                  aria-label="配置 Agent"
                  value={draft.provider}
                  onChange={(event) => change({ provider: event.target.value })}
                >
                  {workbench.providers.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </SettingsRow>
              <SettingsRow
                title="自定义 ACP 启动程序"
                description="可选；留空使用内置入口。"
              >
                <input
                  aria-label="自定义 ACP 启动程序"
                  value={draft.command}
                  placeholder="可执行程序的绝对路径"
                  onChange={(event) => change({ command: event.target.value })}
                />
              </SettingsRow>
              <SettingsRow title="完整启动参数" description="可选，覆盖默认值。">
                <textarea
                  aria-label="启动参数 JSON"
                  value={draft.args}
                  placeholder={'["/path/to/adapter.js"]'}
                  onChange={(event) => change({ args: event.target.value })}
                />
              </SettingsRow>
            </SettingsGroup>
            <div className="settings-form-actions desktop-settings-form-actions">
              <button
                type="button"
                disabled={busy || offline || !selected || selected === "new"}
                onClick={() => void remove()}
              >
                移除配置
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  change({ command: "", args: "" });
                  setError("");
                  setNotice("已恢复默认入口，请保存修订后用于新会话。");
                }}
              >
                恢复默认入口
              </button>
              <button disabled={busy || offline || !draft.name.trim()}>
                {busy
                  ? "正在保存…"
                  : selected && selected !== "new"
                    ? "保存修订"
                    : "保存配置"}
              </button>
            </div>
          </form>
          {error && <p role="alert">{error}</p>}
          {notice && <p role="status">{notice}</p>}
        </section>
      </div>
    </>
  );
}
