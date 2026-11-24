import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  LoaderCircle,
  Plus,
  Save,
  Settings2,
  ShieldCheck,
  Terminal,
  Users,
} from "lucide-react";
import type { AgentConfigOptionInput } from "./agent-config.ts";
import { buildTurns } from "./chat-timeline.ts";
import { AgentResponse, ChatMessage } from "./ChatTimeline.tsx";
import { CompactDialog as Modal } from "./CompactDialog.tsx";
import { CreationMenu } from "./CreationMenu.tsx";
import { InputRequest } from "./InputRequest.tsx";
import { Choice } from "./NewSession.tsx";
import { SidebarHome } from "./ProjectSwitcher.tsx";
import {
  avatarColors,
  avatarShapeNames,
  avatarShapes,
  SessionAvatar,
} from "./SessionIdentity.tsx";
import { isModelOption, modelOptions } from "./session-models.ts";
import type { useSidebarManagement } from "./SidebarManagement.tsx";
import type {
  ActRunner,
  DesktopSession,
  ProjectItem,
  ProjectsController,
  SpaceAgent,
  SpaceGroup,
  SpacePreset,
  SpacesController,
  SpaceThread,
  WorkbenchLike,
} from "./types.ts";
import "./project-spaces.css";

interface SpacesPayload {
  agents: SpaceAgent[];
  threads: SpaceThread[];
  groups: SpaceGroup[];
  presets: SpacePreset[];
}

const blank: SpacesPayload = {
  agents: [],
  threads: [],
  groups: [],
  presets: [],
};

export function useSpaces(workbench: WorkbenchLike): SpacesController {
  const [data, setData] = useState<SpacesPayload>(blank);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const spacesEnabled = Boolean(workbench.features?.includes("projectSpaces"));

  const reload = useCallback(async () => {
    const n = ++generation.current;
    if (workbench.device || !spacesEnabled) {
      return;
    }
    try {
      const result = await workbench.call<SpacesPayload>("/spaces");
      if (n === generation.current) {
        setData(result);
        setError("");
      }
    } catch (e) {
      if (n === generation.current) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  }, [workbench.call, workbench.device, spacesEnabled]);

  useEffect(() => {
    if (workbench.phase !== "online") {
      return;
    }
    void reload();
    const interval = setInterval(() => {
      if (!document.hidden) {
        void reload();
      }
    }, 1800);
    return () => {
      clearInterval(interval);
      generation.current++;
    };
  }, [workbench.phase, reload]);

  const command = async (body: Record<string, unknown>) => {
    const result = await workbench.call<Record<string, unknown>>(
      "/spaces",
      body,
    );
    await reload();
    return result;
  };

  const hidden = new Set(
    data.threads.flatMap((t) => Object.values(t.bindings ?? {})),
  );
  const agentFor = (id: string | null | undefined) =>
    id ? data.agents.find((a) => a.sessionId === id) : undefined;
  const threadFor = (id: string | null | undefined) =>
    id ? data.threads.find((t) => t.id === id) : undefined;

  return {
    ...data,
    error,
    reload,
    command,
    agentFor,
    threadFor,
    hidden,
    enabled: !workbench.device && spacesEnabled,
  };
}

const liveStatus = (
  session?: DesktopSession,
  thread?: SpaceThread | null,
): string =>
  thread?.state === "running"
    ? "协作中"
    : session?.approvals?.length || session?.inputs?.length
      ? "等待处理"
      : ["starting", "running", "cancelling"].includes(session?.status ?? "")
        ? "执行中"
        : thread?.error
          ? "需检查"
          : "就绪";

export function ProjectSpaceSidebar({
  project,
  spaces,
  workbench,
  selected,
  onSelect,
  onBack,
  onCreate,
  onEdit,
  onCode,
  management,
}: {
  project: ProjectItem;
  spaces: SpacesController;
  workbench: WorkbenchLike;
  selected: string | null;
  onSelect: (id: string) => void;
  onBack: () => void;
  onCreate: (kind: "agent" | "project" | "thread" | "display") => void;
  onEdit: (
    initial: SpaceAgent | SpaceThread | SpaceGroup,
    kind: "agent-update" | "thread-update" | "display",
  ) => void;
  onCode: () => void;
  management?: ReturnType<typeof useSidebarManagement>;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const agents = spaces.agents.filter((a) => a.projectId === project.id);
  const threads = spaces.threads.filter(
    (t) => t.projectId === project.id && !t.coordination,
  );
  const groups = spaces.groups.filter((g) => g.projectId === project.id);
  const steward = agents.find((a) => a.steward);

  type SidebarEntry =
    | (SpaceAgent & { kind: "agent"; conversation: string })
    | (SpaceThread & { kind: "thread"; conversation: string });

  const entries: SidebarEntry[] = [
    ...agents
      .filter((a) => !a.steward)
      .map((a) => ({ ...a, kind: "agent" as const, conversation: a.sessionId })),
    ...threads.map((t) => ({
      ...t,
      kind: "thread" as const,
      conversation: t.id,
    })),
  ].filter(
    (item) =>
      !workbench.sessions.find((s) => s.id === item.conversation)?.archived &&
      item.name.toLowerCase().includes(query.toLowerCase()),
  );

  const row = (item: SidebarEntry) => {
    const thread = item.kind === "thread";
    const session = workbench.sessions.find((s) => s.id === item.conversation);
    return (
      <div
        className="space-entry"
        key={item.id}
        onContextMenu={(e) =>
          management?.context(e, {
            kind: "session",
            item: session,
            identity: thread ? null : item,
            thread: thread ? item : null,
          })
        }
      >
        <button
          className={`space-member ${item.conversation === selected ? "selected" : ""}`}
          onClick={() => onSelect(item.conversation)}
        >
          {thread ? (
            <span className="space-group-avatar">
              <Users size={21} />
            </span>
          ) : (
            <SessionAvatar color={item.color} shape={item.shape} />
          )}
          <span>
            <strong>
              {item.name}
              {thread && <small>{item.members.length}</small>}
            </strong>
            <small>
              {thread
                ? "会话组"
                : (workbench.providers.find((p) => p.id === item.provider)
                    ?.name ?? item.provider)}{" "}
              · {liveStatus(session, thread ? item : null)}
            </small>
          </span>
        </button>
        <button
          className="space-edit icon-button"
          aria-label={`编辑${item.name}`}
          onClick={() =>
            onEdit(item, thread ? "thread-update" : "agent-update")
          }
        >
          <Settings2 size={12} />
        </button>
      </div>
    );
  };

  return (
    <aside className="session-sidebar desktop-sidebar project-space-sidebar">
      <header className="space-sidebar-heading">
        <strong
          onContextMenu={(e) =>
            management?.context(e, { kind: "project", item: project })
          }
          title={project.name}
        >
          {project.name}
        </strong>
        <CreationMenu
          onAgent={() => onCreate("agent")}
          onProject={() => onCreate("project")}
        >
          {(
            [
              ["thread", "新建会话组"],
              ["display", "新建分组"],
            ] as const
          ).map(([kind, label]) => (
            <button
              key={kind}
              onClick={(e) => {
                const details = e.currentTarget.closest("details");
                if (details) {
                  details.open = false;
                }
                onCreate(kind);
              }}
            >
              {label}
            </button>
          ))}
        </CreationMenu>
      </header>
      <SidebarHome onClick={onBack} />
      <label className="session-search desktop-search">
        <input
          aria-label="搜索空间成员"
          placeholder="搜索 Agent 与会话组"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {steward && (
        <button
          onContextMenu={(e) =>
            management?.context(e, {
              kind: "session",
              item: workbench.sessions.find((s) => s.id === steward.sessionId),
              identity: steward,
            })
          }
          className={`space-steward ${selected === steward.sessionId ? "selected" : ""}`}
          onClick={() => onSelect(steward.sessionId)}
        >
          <SessionAvatar color="#272727" shape="circle" />
          <strong>管家</strong>
          <small>
            <ShieldCheck size={11} />
            项目协调 · 固定成员
          </small>
        </button>
      )}
      <div className="space-member-list">
        {entries.some((a) => management?.pinned("session", a.conversation)) && (
          <section>
            <div className="space-display-heading">
              <span>置顶</span>
            </div>
            {entries
              .filter((a) => management?.pinned("session", a.conversation))
              .map(row)}
          </section>
        )}
        {[...groups, { id: "", name: "未分组", projectId: project.id }].map(
          (g) => {
            const items = entries.filter(
              (a) =>
                (a.groupId ?? "") === g.id &&
                !management?.pinned("session", a.conversation),
            );
            return (
              <section key={g.id}>
                <div className="space-display-heading">
                  <button
                    onClick={() =>
                      setCollapsed((old) => {
                        const n = new Set(old);
                        if (n.has(g.id)) {
                          n.delete(g.id);
                        } else {
                          n.add(g.id);
                        }
                        return n;
                      })
                    }
                    aria-expanded={!collapsed.has(g.id)}
                  >
                    {collapsed.has(g.id) ? (
                      <ChevronRight size={12} />
                    ) : (
                      <ChevronDown size={12} />
                    )}
                    <span>{g.name}</span>
                    <small>{items.length}</small>
                  </button>
                  {g.id && (
                    <button
                      className="icon-button"
                      aria-label={`重命名分组${g.name}`}
                      onClick={() => onEdit(g, "display")}
                    >
                      <Settings2 size={11} />
                    </button>
                  )}
                </div>
                {!collapsed.has(g.id) &&
                  (management?.sort(items) ?? items).map(row)}
              </section>
            );
          },
        )}
        {!entries.length && (
          <p className="space-empty-copy">
            为项目添加有名字的 Agent，或创建一个协作会话组。
          </p>
        )}
      </div>
      <footer className="space-sidebar-footer">
        <button onClick={onCode}>
          <FolderOpen size={14} />
          查看项目代码
        </button>
        <span>{project.paths.length} 个工作目录</span>
      </footer>
    </aside>
  );
}

export function SpaceOverview({
  projects,
  spaces,
  workbench,
  project,
  onEnter,
  onSelect,
  onCreate,
  onCode,
}: {
  projects: ProjectsController;
  spaces: SpacesController;
  workbench: WorkbenchLike;
  project?: ProjectItem;
  onEnter: (project: ProjectItem) => void;
  onSelect: (id: string) => void;
  onCreate: (kind: "agent" | "thread" | "project") => void;
  onCode: () => void;
}) {
  const visible = workbench.sessions.filter(
    (s) =>
      !spaces.hidden.has(s.id) &&
      !s.archived &&
      (!project || project.paths.includes(s.workspace)),
  );
  const groups = [
    {
      id: "active",
      name: "进行中",
      test: (s: DesktopSession) =>
        spaces.threadFor(s.id)?.state === "running" ||
        ["starting", "running", "cancelling"].includes(s.status),
    },
    {
      id: "waiting",
      name: "待处理",
      test: (s: DesktopSession) =>
        Boolean(s.approvals?.length) ||
        Boolean(s.inputs?.length) ||
        Boolean(spaces.threadFor(s.id)?.error) ||
        ["error", "interrupted"].includes(s.status),
    },
    {
      id: "ready",
      name: "最近对话",
      test: (s: DesktopSession) =>
        !["starting", "running", "cancelling", "error", "interrupted"].includes(
          s.status,
        ) &&
        spaces.threadFor(s.id)?.state !== "running" &&
        !s.approvals?.length &&
        !s.inputs?.length &&
        !spaces.threadFor(s.id)?.error,
    },
  ];

  return (
    <section className="space-overview">
      <header>
        <div>
          <h1>{project ? project.name : "首页"}</h1>
          <p>
            {project
              ? "在这个项目里组织成员、协作任务和代码。"
              : "所有项目的对话与会话组，集中在这里。"}
          </p>
        </div>
        {project ? (
          <div className="space-overview-actions">
            <button onClick={onCode}>
              <FolderOpen size={15} />
              代码
            </button>
            <button onClick={() => onCreate("agent")}>
              <Plus size={15} />
              Agent
            </button>
            <button onClick={() => onCreate("thread")}>
              <Users size={15} />
              会话组
            </button>
          </div>
        ) : null}
      </header>
      {!project && (
        <div className="space-projects">
          {projects.items.map((p) => (
            <button key={p.id} onClick={() => onEnter(p)}>
              <FolderOpen size={22} />
              <span>
                <strong>{p.name}</strong>
                <small>
                  {p.paths.length} 个目录 ·{" "}
                  {visible.filter((s) => p.paths.includes(s.workspace)).length}{" "}
                  个对话
                </small>
              </span>
              <ArrowUpRight size={16} />
            </button>
          ))}
          {!projects.items.length && (
            <p>先在设置中创建项目并引入工作目录。</p>
          )}
        </div>
      )}
      <div className="space-board">
        {groups.map((g) => {
          const list = visible
            .filter(g.test)
            .sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0));
          return (
            <section key={g.id}>
              <header>
                <h2>{g.name}</h2>
                <small>{list.length}</small>
              </header>
              {list.map((s) => {
                const a = spaces.agentFor(s.id);
                const t = spaces.threadFor(s.id);
                return (
                  <button
                    className="space-board-item"
                    key={s.id}
                    onClick={() => onSelect(s.id)}
                  >
                    <span className="space-board-identity">
                      {t && !t.coordination ? (
                        <Users size={16} />
                      ) : (
                        <SessionAvatar color={a?.color} shape={a?.shape} />
                      )}
                      <strong>{a?.name ?? t?.name ?? s.title}</strong>
                    </span>
                    <p>
                      {s.messages
                        .filter(
                          (m) => m.role === "assistant" || m.role === "user",
                        )
                        .at(-1)
                        ?.text?.slice(0, 140) || "尚未开始对话"}
                    </p>
                    <small>
                      {
                        projects.items.find((p) =>
                          p.paths.includes(s.workspace),
                        )?.name
                      }{" "}
                      · {liveStatus(s, t)}
                    </small>
                  </button>
                );
              })}
              {!list.length && (
                <p className="space-board-empty">
                  {g.id === "ready" ? "暂无对话" : "当前没有"}
                  {g.id === "active"
                    ? "进行中的任务"
                    : g.id === "waiting"
                      ? "待处理事项"
                      : ""}
                </p>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}

export function SpaceEditor({
  kind,
  initial,
  project,
  spaces,
  workbench,
  onClose,
  onCreated,
  projectChoices,
  onProjectChange,
}: {
  kind: "agent" | "agent-update" | "thread" | "thread-update" | "display";
  initial?: {
    id?: string;
    name?: string;
    role?: string;
    profileId?: string;
    provider?: string;
    workspace?: string;
    color?: string;
    shape?: string;
    groupId?: string | null;
  };
  project: ProjectItem;
  spaces: SpacesController;
  workbench: WorkbenchLike;
  onClose: () => void;
  onCreated?: (id: string | null) => void;
  projectChoices?: ProjectItem[] | null;
  onProjectChange?: (id: string) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [role, setRole] = useState(initial?.role ?? "");
  const [provider, setProvider] = useState(
    initial?.profileId ?? initial?.provider ?? "codex",
  );
  const [workspace, setWorkspace] = useState(
    initial?.workspace ?? project.paths[0] ?? "",
  );
  const [color, setColor] = useState(initial?.color ?? "#347DE1");
  const [shape, setShape] = useState(initial?.shape ?? "circle");
  const [avatarTab, setAvatarTab] = useState<"color" | "shape">("color");
  const [members, setMembers] = useState<string[]>([]);
  const [groupId, setGroupId] = useState(initial?.groupId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [model, setModel] = useState("");
  const [options, setOptions] = useState<AgentConfigOptionInput[] | null>(null);
  const [loading, setLoading] = useState(false);

  const intent = useRef(crypto.randomUUID());
  const epoch = useRef(0);
  const creatingAgent = kind === "agent";
  const editingAgent = kind === "agent-update";
  const thread = kind === "thread";
  const presetId = useRef<SpacePreset | null>(null);
  const agent = creatingAgent || editingAgent;

  const profile = (workbench.profiles ?? []).find((p) => p.id === provider);
  const providerId = profile?.provider ?? provider;
  const selected = workbench.providers.find((p) => p.id === providerId);
  const available = Boolean(selected?.available || profile?.command);
  const option = options?.find(isModelOption);
  const choices = modelOptions(option);

  useEffect(() => {
    epoch.current++;
    setOptions(null);
    setModel("");
    setLoading(false);
    return () => {
      epoch.current++;
    };
  }, [provider, workspace]);

  const loadModels = async () => {
    if (loading || !available || providerId.includes(":")) {
      return;
    }
    const n = ++epoch.current;
    setLoading(true);
    try {
      const result = await workbench.call<{
        configOptions?: AgentConfigOptionInput[];
      }>(`/providers/${providerId}/models`, {
        workspace,
        profileId: profile?.id,
      });
      if (n === epoch.current) {
        setOptions(result.configOptions ?? []);
        setModel("");
      }
    } catch (e) {
      if (n === epoch.current) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (n === epoch.current) {
        setLoading(false);
      }
    }
  };

  const applyPreset = (id: string) => {
    const p = spaces.presets.find((item) => item.id === id);
    if (p) {
      setName(p.name);
      setRole(p.role ?? "");
      setProvider(p.profileId ?? p.provider ?? "codex");
      setColor(p.color ?? "#347DE1");
      setShape(p.shape ?? "circle");
      presetId.current = p;
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const selection =
        model && option?.configId
          ? { id: option.configId, value: model }
          : (presetId.current?.model ?? null);
      const body = {
        action: kind,
        projectId: project.id,
        id: initial?.id ?? intent.current,
        name,
        role,
        provider: providerId,
        profileId: profile?.id,
        workspace,
        color,
        shape,
        members,
        groupId: groupId || null,
        model: selection,
      };
      const result = await spaces.command(body);
      const createdId =
        typeof result.sessionId === "string"
          ? result.sessionId
          : thread && typeof result.id === "string"
            ? result.id
            : null;
      onCreated?.(createdId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const titleMap: Record<string, string> = {
    agent: "新建 Agent",
    "agent-update": "编辑 Agent",
    thread: "新建会话组",
    "thread-update": "编辑会话组",
    display: initial ? "重命名分组" : "新建分组",
  };
  const title = titleMap[kind] ?? "编辑";

  return (
    <Modal title={title} close={onClose} busy={busy}>
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          {creatingAgent && projectChoices && (
            <label className="space-field">
              所属项目
              <select
                aria-label="Agent所属项目"
                value={project.id}
                onChange={(e) => onProjectChange?.(e.target.value)}
              >
                {projectChoices.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {creatingAgent && spaces.presets.length > 0 && (
            <label className="space-field">
              从预设创建
              <select
                aria-label="Agent预设"
                defaultValue=""
                onChange={(e) => applyPreset(e.target.value)}
              >
                <option value="">自定义 Agent</option>
                {spaces.presets.map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="space-field">
            {thread || kind === "thread-update"
              ? "会话组名称"
              : agent
                ? "Agent 名称"
                : "分组名称"}
            <input
              autoFocus
              aria-label="名称"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={100}
              placeholder={
                agent
                  ? "例如：前端工程师"
                  : thread
                    ? "例如：页面改版协作"
                    : "例如：开发团队"
              }
            />
          </label>
          {agent && (
            <>
              <div className="space-avatar-editor">
                <SessionAvatar color={color} shape={shape} />
                <div>
                  <div className="new-avatar-tabs">
                    <span>成员图标</span>
                    <button
                      type="button"
                      aria-pressed={avatarTab === "color"}
                      onClick={() => setAvatarTab("color")}
                    >
                      颜色
                    </button>
                    <button
                      type="button"
                      aria-pressed={avatarTab === "shape"}
                      onClick={() => setAvatarTab("shape")}
                    >
                      形状
                    </button>
                  </div>
                  {avatarTab === "color" ? (
                    <div className="new-avatar-colors">
                      {avatarColors.map((c) => (
                        <button
                          type="button"
                          key={c}
                          aria-label={`选择颜色${c}`}
                          aria-pressed={color === c}
                          onClick={() => setColor(c)}
                        >
                          <span style={{ background: c }} />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="new-avatar-shapes">
                      {avatarShapes.map((s, i) => (
                        <button
                          type="button"
                          key={s}
                          aria-label={avatarShapeNames[i]}
                          aria-pressed={shape === s}
                          onClick={() => setShape(s)}
                        >
                          <SessionAvatar color={color} shape={s} />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <label className="space-field">
                职责与角色
                <textarea
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  maxLength={8000}
                  rows={3}
                  placeholder="描述这个 Agent 擅长什么、在项目中的职责…"
                />
              </label>
            </>
          )}
          {(creatingAgent || thread) && (
            <label className="space-field">
              工作目录
              <select
                aria-label="空间工作目录"
                value={workspace}
                onChange={(e) => setWorkspace(e.target.value)}
              >
                {project.paths.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
          )}
          {creatingAgent && (
            <>
              <div className="space-field">
                Agent 工具
                <Choice
                  label="Agent工具"
                  value={provider}
                  icon={Terminal}
                  options={[
                    ...workbench.providers.map((p) => ({
                      value: p.id,
                      label: p.name,
                      disabled: !p.available,
                    })),
                    ...(workbench.profiles ?? []).map((p) => ({
                      value: p.id,
                      label: p.name,
                    })),
                  ]}
                  onChange={(value) => {
                    presetId.current = null;
                    setProvider(value);
                  }}
                  up
                />
              </div>
              <div className="space-model-field">
                <div className="space-field">
                  模型
                  <Choice
                    label="Agent模型"
                    value={model}
                    options={[
                      {
                        value: "",
                        label: presetId.current?.model
                          ? "使用预设模型"
                          : "使用 Agent 默认模型",
                      },
                      ...choices,
                    ]}
                    onChange={setModel}
                    onOpen={() => {
                      if (options === null) {
                        void loadModels();
                      }
                    }}
                    up
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void loadModels()}
                  disabled={loading || !available}
                >
                  {loading ? (
                    <LoaderCircle size={16} className="desktop-spin" />
                  ) : (
                    "刷新"
                  )}
                </button>
              </div>
            </>
          )}
          {thread && (
            <div className="space-field">
              参与成员 <small>选择2到8位，@名字可以指定发言</small>
              <div className="space-member-picker">
                {spaces.agents
                  .filter((a) => a.projectId === project.id)
                  .map((a) => (
                    <label key={a.id}>
                      <input
                        type="checkbox"
                        checked={members.includes(a.id)}
                        onChange={() =>
                          setMembers((m) =>
                            m.includes(a.id)
                              ? m.filter((id) => id !== a.id)
                              : [...m, a.id],
                          )
                        }
                      />
                      <SessionAvatar color={a.color} shape={a.shape} />
                      <span>{a.name}</span>
                      {a.steward && <small>管家</small>}
                    </label>
                  ))}
              </div>
            </div>
          )}
          {(editingAgent || kind === "thread-update") && (
            <label className="space-field">
              显示分组
              <select
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
              >
                <option value="">未分组</option>
                {spaces.groups
                  .filter((g) => g.projectId === project.id)
                  .map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
        </fieldset>
        {error && (
          <p role="alert" className="space-editor-error">
            {error}
          </p>
        )}
        <footer>
          {agent && (
            <button
              type="button"
              disabled={busy || !name.trim()}
              onClick={async () => {
                setBusy(true);
                try {
                  await spaces.command({
                    action: "preset",
                    id: crypto.randomUUID(),
                    name,
                    role,
                    provider: providerId,
                    profileId: profile?.id,
                    color,
                    shape,
                    model:
                      model && option?.configId
                        ? { id: option.configId, value: model }
                        : null,
                  });
                  setError("预设已保存");
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Save size={13} />
              存为预设
            </button>
          )}
          <button
            type="submit"
            className="space-primary"
            disabled={
              busy ||
              !name.trim() ||
              (creatingAgent && !available) ||
              (thread && members.length < 2)
            }
          >
            {busy ? (
              <LoaderCircle size={14} className="desktop-spin" />
            ) : (
              <Check size={14} />
            )}{" "}
            {initial ? "保存" : "创建"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

export function GroupTranscript({
  thread,
  session,
  workbench,
  spaces,
  act,
  onOpenExecution,
}: {
  thread: SpaceThread;
  session: DesktopSession;
  workbench: WorkbenchLike;
  spaces: SpacesController;
  act: ActRunner;
  onOpenExecution: (id: string) => void;
}) {
  const member = workbench.sessions.find((s) => s.id === thread.activeSession);
  const activeAgentId = Object.entries(thread.bindings ?? {}).find(
    ([, sid]) => sid === member?.id,
  )?.[0];
  const agent = spaces.agents.find((a) => a.id === activeAgentId);
  const activeTurns = member ? buildTurns(member) : [];
  const latestTurn = activeTurns.at(-1);

  return (
    <div className="space-group-transcript">
      <div className="space-group-description">
        <Users size={14} />
        {thread.members
          .map(
            (id) =>
              spaces.agents.find((a) => a.id === id)?.name ?? "Agent",
          )
          .join(" · ")}
      </div>
      {session.messages.map((m) => {
        const msgAgentId = typeof m.agentId === "string" ? m.agentId : "";
        const msgAgent = spaces.agents.find((a) => a.id === msgAgentId);
        return m.role === "user" ? (
          <div key={m.id} data-turn-id={`user:${m.id}`} tabIndex={-1}>
            <ChatMessage message={m} />
          </div>
        ) : (
          <div className="space-group-reply" key={m.id}>
            <header>
              <SessionAvatar
                color={msgAgent?.color}
                shape={msgAgent?.shape}
              />
              <strong>
                {typeof m.agentName === "string" ? m.agentName : "Agent"}
              </strong>
            </header>
            <ChatMessage message={m} />
          </div>
        );
      })}
      {thread.state === "running" && (
        <section className="space-live-execution">
          <header>
            <LoaderCircle className="desktop-spin" size={13} />
            {agent?.name ?? "管家"} 正在处理
            <button
              disabled={!member}
              onClick={() => {
                if (member) {
                  onOpenExecution(member.id);
                }
              }}
            >
              打开成员执行详情
              <ArrowUpRight size={12} />
            </button>
          </header>
          {member && latestTurn && (
            <AgentResponse
              turn={{ ...latestTurn, user: null }}
              name={agent?.name ?? "Agent"}
              status={member.status}
              hasInput={Boolean(member.inputs?.length)}
              changeCount={0}
            />
          )}
          {member?.inputs?.map((request) => (
            <InputRequest
              key={request.id}
              request={request}
              session={member}
              workbench={workbench}
              online
              act={act}
            />
          ))}
          {member?.approvals?.map((a) => (
            <section className="desktop-approval" key={a.id}>
              <h2>{a.title}</h2>
              <p>{a.description}</p>
              <div className="desktop-approval-actions">
                {(a.options ?? []).map((o) => (
                  <button
                    key={o.optionId}
                    onClick={() =>
                      void act(() =>
                        workbench.call(
                          `/sessions/${member.id}/approvals/${a.id}`,
                          { option: o.optionId },
                        ),
                      )
                    }
                  >
                    {o.name}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </section>
      )}
      {thread.error && (
        <p role="alert" className="space-editor-error">
          {thread.error}
          {thread.activeSession && (
            <button onClick={() => onOpenExecution(thread.activeSession!)}>
              查看成员执行详情
            </button>
          )}
        </p>
      )}
      {thread.state === "interrupted" && (
        <p>协作因主机重启而中断；发送新消息继续，不自动重发。</p>
      )}
    </div>
  );
}
