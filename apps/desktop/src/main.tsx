import React, {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDown,
  ArrowUp,
  AtSign,
  Check,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  GitBranch,
  LoaderCircle,
  MessageSquare,
  Monitor,
  Moon,
  MoreHorizontal,
  Paperclip,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Slash,
  Square,
  Sun,
  Users,
  X,
} from "lucide-react";
import { submitMessage as submitMessageCommand } from "@vibeone/client-contracts";
import { AgentConfigControls } from "./AgentConfigControls.tsx";
import { isNative } from "./api.ts";
import { applyAppearance, readAppearance } from "./appearance.ts";
import { AppearanceSettings, useAppearance } from "./AppearanceSettings.tsx";
import { ApprovedWorkbenchShell, IconButton } from "./ApprovedWorkbenchShell.tsx";
import { AttachmentPicker, useAttachmentDraft } from "./Attachments.tsx";
import { Brand, BrandMark } from "./Brand.tsx";
import { buildTurns } from "./chat-timeline.ts";
import {
  AgentResponse,
  ChatMessage,
  type TurnChangesSnapshot,
} from "./ChatTimeline.tsx";
import { commandPanel, groupReferenceText } from "./composer.ts";
import { ComposerInput, type ComposerInputHandle } from "./ComposerInput.tsx";
import { ContextTabs } from "./ContextTabs.tsx";
import {
  captureHistoryAnchor,
  restoreHistoryAnchor,
  type HistoryAnchor,
} from "./conversation-history.ts";
import { ConversationNav } from "./ConversationNav.tsx";
import { CreateProjectDialog } from "./CreateProjectDialog.tsx";
import { CreationMenu } from "./CreationMenu.tsx";
import { InputRequest } from "./InputRequest.tsx";
import { NewSession } from "./NewSession.tsx";
import { useNotifications } from "./notifications.ts";
import { usePlugins } from "./plugins.tsx";
import { PreviewContext } from "./PreviewLinks.tsx";
import { projectGroups, useProjects } from "./projects.tsx";
import {
  GroupTranscript,
  ProjectSpaceSidebar,
  SpaceEditor,
  SpaceOverview,
  useSpaces,
} from "./ProjectSpaces.tsx";
import { ProjectSwitcher, SidebarHome } from "./ProjectSwitcher.tsx";
import { recentSessions } from "./session-groups.ts";
import { PhoneGate } from "./Remote.tsx";
import {
  RunChanges,
  WorkspaceChangeOverview,
  type WorkspaceChangeSummary,
} from "./RunChanges.tsx";
import { SessionRow } from "./SessionIdentity.tsx";
import { SessionTools, Queue } from "./SessionTools.tsx";
import { useSidebarManagement } from "./SidebarManagement.tsx";
import { SplitHandle } from "./SplitHandle.tsx";
import { useArtifactCapture } from "./use-artifact-capture.ts";
import { useConversationHistory } from "./use-conversation-history.ts";
import { useMetadataCommands } from "./use-metadata-commands.ts";
import { useQueueCommands } from "./use-queue-commands.ts";
import { useStopCommand } from "./use-stop-command.ts";
import { useWorkbench } from "./use-workbench.ts";
import { WorkspaceExtensions } from "./workspace-extensions.tsx";
import type {
  ActRunner,
  DesktopSession,
  ProjectItem,
  SpaceAgent,
  SpacesController,
  SpaceThread,
  WorkbenchLike,
} from "./types.ts";
import "./approved/review.css";
import "./approved/settings-review.css";
import "./runtime-states.css";
import "./diff-treatment.css";
import "./pane-resize.css";

const SettingsCenter = lazy(() =>
  import("./SettingsCenter.tsx").then((module) => ({
    default: module.SettingsCenter,
  })),
);

const labels: Record<string, string> = {
  idle: "就绪",
  starting: "正在启动",
  running: "运行中",
  requires_action: "等待审批",
  cancelling: "正在停止",
  disconnected: "已断开",
  interrupted: "已中断",
  error: "执行失败",
};

function sessionLabel(session: DesktopSession): string {
  if (
    session.inputs?.length &&
    ["starting", "running", "requires_action"].includes(session.status)
  ) {
    return session.approvals?.length ? "等待处理" : "等待补充信息";
  }
  return labels[session.status] ?? session.status;
}

function savedTheme(): string {
  try {
    return localStorage.getItem("vibeone-theme") || "system";
  } catch {
    return "system";
  }
}

function applyTheme(theme: string): void {
  document.documentElement.dataset.theme =
    theme === "system"
      ? matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;
}

applyTheme(savedTheme());
applyAppearance(
  readAppearance(),
  document.documentElement.dataset.theme === "dark" ? "dark" : "light",
);

interface SpaceEditorState {
  kind: "agent" | "agent-update" | "thread" | "thread-update" | "display";
  projectId?: string;
  preservePage?: boolean;
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
}

function App() {
  const workbench = useWorkbench() as WorkbenchLike;
  const plugins = usePlugins(workbench);
  const projects = useProjects(workbench);
  const [newProject, setNewProject] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const spaces = useSpaces(workbench);
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [overview, setOverview] = useState(true);
  const [spaceEditor, setSpaceEditor] = useState<SpaceEditorState | null>(null);
  const [projectBusy, setProjectBusy] = useState(false);
  const projectSwitching = useRef(false);

  const [selected, setSelected] = useState<string | null>(null);
  const [showList, setShowList] = useState(true);
  const [creating, setCreating] = useState(false);
  const [settings, setSettings] = useState(false);
  const [query, setQuery] = useState("");
  const searchInput = useRef<HTMLInputElement | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const n = Number(localStorage.getItem("vibeone-sidebar-width"));
      return n >= 200 && n <= 480 ? n : 224;
    } catch {
      return 224;
    }
  });
  const lastPanel = useRef("home");
  useEffect(() => {
    try {
      localStorage.setItem("vibeone-sidebar-width", String(sidebarWidth));
    } catch {
      // 忽略本地存储异常
    }
  }, [sidebarWidth]);

  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try {
      return localStorage.getItem("vibeone-sidebar-open") !== "false";
    } catch {
      return true;
    }
  });
  const sessionView = "projects";
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(
    new Set(),
  );
  const [settingsTarget, setSettingsTarget] = useState("general");
  const [panel, setPanel] = useState("chat");
  const [panelWidth, setPanelWidth] = useState<number | null>(() => {
    try {
      const width = Number(localStorage.getItem("vibeone-panel-width"));
      return width >= 280 && width <= 2400 ? width : null;
    } catch {
      return null;
    }
  });
  const [expandedPanel, setExpandedPanel] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem("vibeone-sidebar-open", String(sidebarOpen));
      localStorage.setItem("vibeone-session-view-v2", sessionView);
    } catch {
      // 忽略本地存储异常
    }
  }, [sidebarOpen, sessionView]);

  useEffect(() => {
    const search = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSidebarOpen(true);
        setShowList(true);
        setSettings(false);
        requestAnimationFrame(() => {
          searchInput.current?.focus();
          searchInput.current?.select();
        });
      }
    };
    document.addEventListener("keydown", search);
    return () => document.removeEventListener("keydown", search);
  }, []);

  const archived = false;
  const [error, setError] = useState("");
  const [theme, setTheme] = useState(savedTheme);
  const sidebarManagement = useSidebarManagement({
    workbench,
    spaces,
    onError: setError,
  });
  const appearance = useAppearance(theme);

  const act: ActRunner = async (operation) => {
    setError("");
    try {
      return await operation();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    }
  };

  const home = () => {
    setSpaceId(null);
    setOverview(true);
    setCreating(false);
    setSettings(false);
    setPanel("chat");
  };

  const currentProject = projects.items.find((p) => p.id === spaceId);
  const openSession = (id: string) => {
    setSelected(id);
    setOverview(false);
    setCreating(false);
    setSettings(false);
    setShowList(false);
  };

  const enterProject = async (project: ProjectItem): Promise<boolean> => {
    if (projectSwitching.current) {
      return false;
    }
    projectSwitching.current = true;
    setProjectBusy(true);
    setCreating(false);
    setSettings(false);
    try {
      const result = await act(() =>
        spaces.command({ action: "enter", projectId: project.id }),
      );
      if (result) {
        setSpaceId(project.id);
        setOverview(true);
        setPanel("chat");
        setSpaceEditor(null);
      }
      return Boolean(result);
    } finally {
      projectSwitching.current = false;
      setProjectBusy(false);
    }
  };

  const openCode = () => {
    const steward = spaces.agents.find(
      (a) => a.projectId === spaceId && a.steward,
    );
    if (steward) {
      openSession(steward.sessionId);
      setPanel("files");
    }
  };

  useNotifications(workbench);

  useEffect(() => {
    const update = () =>
      document.documentElement.toggleAttribute(
        "data-motion-paused",
        document.hidden,
      );
    document.addEventListener("visibilitychange", update);
    update();
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => applyTheme(theme);
    apply();
    media.addEventListener("change", apply);
    try {
      localStorage.setItem("vibeone-theme", theme);
    } catch {
      // 内存态主题仍生效
    }
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  const online = workbench.phase === "online" && !workbench.storageError;
  const rawSession = workbench.sessions.find(
    (session) => session.id === selected,
  );
  const agentIdentity = spaces.agentFor(selected);
  const session =
    rawSession && agentIdentity
      ? { ...rawSession, title: agentIdentity.name }
      : rawSession;

  const sessions = recentSessions(
    workbench.sessions.filter(
      (item) =>
        !spaces.hidden.has(item.id) &&
        Boolean(item.archived) === archived &&
        `${item.title} ${item.workspace}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    ),
  );

  const pending = workbench.sessions.reduce(
    (count, item) => count + item.approvals.length + (item.inputs?.length ?? 0),
    0,
  );

  const renderSession = (item: DesktopSession) => {
    const identity = spaces.agentFor(item.id);
    const thread = spaces.threadFor(item.id);
    return (
      <SessionRow
        onContextMenu={(e) =>
          sidebarManagement.context(e, {
            kind: "session",
            item,
            identity,
            thread,
          })
        }
        pinned={sidebarManagement.pinned("session", item.id)}
        key={item.id}
        item={{
          ...item,
          title: identity?.name ?? thread?.name ?? item.title,
          avatar: identity?.color && identity?.shape
            ? { color: identity.color, shape: identity.shape }
            : null,
        }}
        selected={!overview && !creating && item.id === selected}
        provider={
          thread?.coordination
            ? "项目管家"
            : thread
              ? "会话组"
              : (workbench.providers.find(
                  (provider) => provider.id === item.provider,
                )?.name ?? item.provider)
        }
        status={thread?.state === "running" ? "协作中" : sessionLabel(item)}
        onSelect={() => openSession(item.id)}
      />
    );
  };

  const mode = appearance.dark ? "dark" : "light";
  const colors = appearance.value[mode];
  useEffect(() => {
    if (panel !== "chat") {
      lastPanel.current = panel;
    }
  }, [panel]);
  useEffect(() => {
    if (panelWidth) {
      try {
        localStorage.setItem("vibeone-panel-width", String(panelWidth));
      } catch {
        // 忽略本地存储异常
      }
    }
  }, [panelWidth]);

  const colorStyle = {
    "--sidebar-width": `${sidebarWidth}px`,
    "--accent": appearance.value.accent,
    "--link": "color-mix(in srgb,var(--accent) 70%,var(--fg))",
    ...(panelWidth ? { "--panel-width": `${panelWidth}px` } : {}),
    ...(colors.background || colors.foreground
      ? {
          "--bg":
            colors.background ?? (appearance.dark ? "#181818" : "#FFFFFF"),
          "--fg":
            colors.foreground ?? (appearance.dark ? "#FFFFFF" : "#1A1C1F"),
          "--sidebar": "color-mix(in srgb,var(--bg) 97%,var(--fg))",
          "--panel": "var(--bg)",
          "--bar": "color-mix(in srgb,var(--bg) 94%,var(--fg))",
          "--raised": "color-mix(in srgb,var(--bg) 91%,var(--fg))",
          "--hover": "color-mix(in srgb,var(--bg) 92%,var(--fg))",
          "--selected": "color-mix(in srgb,var(--bg) 86%,var(--fg))",
          "--muted": "color-mix(in srgb,var(--fg) 64%,var(--bg))",
          "--line": "color-mix(in srgb,var(--bg) 88%,var(--fg))",
          "--border": "color-mix(in srgb,var(--bg) 62%,var(--fg))",
        }
      : {}),
  } as React.CSSProperties;

  const editorProject =
    projects.items.find((p) => p.id === spaceEditor?.projectId) ??
    currentProject;

  return (
    <WorkspaceExtensions plugins={plugins}>
      <ApprovedWorkbenchShell
        dark={appearance.dark}
        colorStyle={colorStyle}
        sidebarOpen={sidebarOpen}
        hasPanel={panel !== "chat" && !settings && !creating}
        wide={expandedPanel}
        settings={settings}
        native={isNative()}
        mobileList={showList}
        title={
          currentProject?.name ??
          (overview
            ? "所有项目"
            : creating || !session
              ? "新会话"
              : session.title)
        }
        navigation={
          spaces.enabled ? (
            <ProjectSwitcher
              project={currentProject}
              projects={sidebarManagement.sort(projects.items, "project")}
              onSelect={enterProject}
              busy={projectBusy}
            />
          ) : null
        }
        connectionLabel={
          online
            ? "工作主机 · 本机已连接"
            : workbench.phase === "upgrading"
              ? "正在重启工作主机"
              : "正在连接工作主机"
        }
        onResizeSidebar={setSidebarWidth}
        onExpandSidebar={() => setSidebarOpen(true)}
        onCollapseSidebar={() => setSidebarOpen(false)}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        onOpenList={() => {
          setSidebarOpen(true);
          setShowList(true);
        }}
        panel={panel}
        onPanel={(value) => {
          setSettings(false);
          setPanel(value);
        }}
        sidebar={
          currentProject && spaces.enabled ? (
            <ProjectSpaceSidebar
              project={currentProject}
              spaces={spaces}
              workbench={workbench}
              selected={overview ? null : selected}
              onSelect={openSession}
              onBack={home}
              onCreate={(kind) =>
                kind === "project"
                  ? setCreatingProject(true)
                  : setSpaceEditor({ kind })
              }
              onEdit={(initial, kind) => setSpaceEditor({ initial, kind })}
              onCode={openCode}
              management={sidebarManagement}
            />
          ) : (
            <aside className="session-sidebar desktop-sidebar">
              <div className="brand desktop-brand">
                <Brand />
                <CreationMenu
                  onAgent={() => {
                    const project =
                      projects.items.find((p) => p.id === spaceId) ??
                      projects.items.find(
                        (p) =>
                          session?.workspace &&
                          p.paths.includes(session.workspace),
                      ) ??
                      projects.items.find((p) => p.paths.length);
                    if (spaces.enabled && project) {
                      setSpaceEditor({
                        kind: "agent",
                        projectId: project.id,
                        preservePage: true,
                      });
                    } else if (spaces.enabled) {
                      setError("请先创建项目并添加一个工作目录");
                    } else {
                      setNewProject(project?.id ?? "");
                      setCreating(true);
                    }
                  }}
                  onProject={() => setCreatingProject(true)}
                />
              </div>
              {spaces.enabled && (
                <SidebarHome
                  active={overview && !currentProject && !settings}
                  onClick={home}
                />
              )}
              <label className="session-search desktop-search">
                <Search size={14} />
                <input
                  aria-label="搜索会话"
                  ref={searchInput}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索会话"
                />
                <kbd>⌘ K</kbd>
              </label>
              <button
                className="sidebar-action desktop-nav"
                onClick={() => {
                  const attention = workbench.sessions.find(
                    (item) => item.approvals.length || item.inputs?.length,
                  );
                  if (attention) {
                    setOverview(false);
                    setSelected(attention.id);
                    setCreating(false);
                    setShowList(false);
                    setSettings(false);
                  } else {
                    setError("当前没有待处理的审批请求");
                  }
                }}
              >
                <ShieldCheck size={16} />
                待处理<span className="count desktop-count">{pending}</span>
              </button>
              <div className="session-list desktop-session-list">
                <div className="section-label">
                  <span>{archived ? "已归档" : "项目"}</span>
                  <div className="session-list-actions">
                    {!workbench.device && (
                      <button
                        className="icon-button"
                        aria-label="添加项目"
                        onClick={() => setCreatingProject(true)}
                      >
                        <Plus size={13} />
                      </button>
                    )}
                  </div>
                </div>
                {sidebarManagement
                  .sort(
                    projectGroups(
                      sessions,
                      projects.items,
                      workbench.workspaces,
                    ),
                    "project",
                  )
                  .map((group) => (
                    <section className="desktop-project-group" key={group.id}>
                      <div
                        className="project-sidebar-heading"
                        onContextMenu={(e) =>
                          sidebarManagement.context(e, {
                            kind: "project",
                            item: group,
                          })
                        }
                      >
                        <button
                          className="project-name desktop-project-heading"
                          title={group.paths.join("\n")}
                          aria-expanded={
                            Boolean(query.trim()) ||
                            !collapsedProjects.has(group.id)
                          }
                          onClick={() =>
                            setCollapsedProjects((previous) => {
                              const next = new Set(previous);
                              if (next.has(group.id)) {
                                next.delete(group.id);
                              } else {
                                next.add(group.id);
                              }
                              return next;
                            })
                          }
                        >
                          <ChevronRight size={12} />
                          <FolderOpen size={13} />
                          <span>
                            {group.name}
                            {sidebarManagement.pinned("project", group.id) && (
                              <Pin size={10} className="sidebar-pin" />
                            )}
                          </span>
                          <small>{group.sessions.length}</small>
                        </button>
                        {spaces.enabled && (
                          <button
                            className="icon-button space-enter"
                            aria-label={`进入项目空间${group.name}`}
                            title="进入项目空间"
                            onClick={() => void enterProject(group)}
                          >
                            <ChevronRight size={13} />
                          </button>
                        )}
                        <button
                          className="icon-button"
                          aria-label={`在项目 ${group.name} 新建会话`}
                          onClick={() => {
                            if (spaces.enabled) {
                              void enterProject(group).then((ok) => {
                                if (ok) {
                                  setSpaceEditor({ kind: "agent" });
                                }
                              });
                            } else {
                              setNewProject(group.id);
                              setCreating(true);
                              setSettings(false);
                              setShowList(false);
                            }
                          }}
                        >
                          <Plus size={13} />
                        </button>
                      </div>
                      {(Boolean(query.trim()) ||
                        !collapsedProjects.has(group.id)) &&
                        sidebarManagement
                          .sort(group.sessions)
                          .map(renderSession)}
                    </section>
                  ))}
                {!sessions.length &&
                  !projects.items.some((p) => !p.implicit) && (
                    <p className="desktop-list-empty">
                      {query ? "没有匹配的会话" : "从一个新项目开始"}
                    </p>
                  )}
              </div>
              <div className="sidebar-footer desktop-sidebar-bottom">
                <div className="desktop-host">
                  <span
                    className={`desktop-dot ${online ? "online" : ""}`}
                  />
                  <div>
                    <strong>工作主机</strong>
                    <small>
                      {online
                        ? "本机 · 已连接"
                        : workbench.phase === "upgrading"
                          ? "正在重启"
                          : workbench.phase === "connecting"
                            ? "正在连接"
                            : "连接已断开"}
                    </small>
                  </div>
                  <Monitor size={16} />
                </div>
                <div className="sidebar-bottom desktop-sidebar-actions">
                  <button
                    className="icon-button desktop-icon"
                    aria-label="连接与设置"
                    onClick={() => {
                      setSettingsTarget("general");
                      setSettings(!settings);
                      setShowList(false);
                    }}
                  >
                    <Settings2 size={16} />
                  </button>
                  <label className="theme-select desktop-theme">
                    {theme === "dark" ? (
                      <Moon size={14} />
                    ) : (
                      <Sun size={14} />
                    )}
                    <select
                      aria-label="主题"
                      value={theme}
                      onChange={(event) => setTheme(event.target.value)}
                    >
                      <option value="system">跟随系统</option>
                      <option value="light">亮色</option>
                      <option value="dark">暗色</option>
                    </select>
                  </label>
                </div>
              </div>
            </aside>
          )
        }
      >
        {online &&
          workbench.providers.length > 0 &&
          workbench.apiVersion !== 3 && (
            <div className="desktop-alert" role="status">
              当前主机为旧版本，请结束执行后在设置中重启工作主机，启用本版功能。
            </div>
          )}
        {(error || workbench.storageError || workbench.error || !online) && (
          <div className="desktop-alert" role="status">
            <span>
              {error ||
                workbench.storageError ||
                workbench.error ||
                (workbench.phase === "upgrading"
                  ? "正在重启工作主机，会话记录已保存。"
                  : "主机连接中，连接完成后可以创建会话。")}
            </span>
            {!online ? (
              <button
                disabled={workbench.phase === "upgrading"}
                onClick={() => void workbench.reconnect()}
              >
                <RefreshCw size={14} />
                重新连接
              </button>
            ) : (
              <button
                className="desktop-icon"
                aria-label="关闭提示"
                onClick={() => setError("")}
              >
                <X size={14} />
              </button>
            )}
          </div>
        )}
        {spaceEditor && editorProject && (
          <SpaceEditor
            key={spaceEditor.projectId ?? currentProject?.id}
            {...spaceEditor}
            project={editorProject}
            projectChoices={
              spaceEditor.preservePage
                ? projects.items.filter((p) => p.paths.length > 0)
                : null
            }
            onProjectChange={(id) =>
              setSpaceEditor({ ...spaceEditor, projectId: id })
            }
            spaces={spaces}
            workbench={workbench}
            onClose={() => setSpaceEditor(null)}
            onCreated={(id) => {
              if (id && !spaceEditor.preservePage) {
                openSession(id);
              }
            }}
          />
        )}
        {sidebarManagement.overlay}
        {creatingProject && (
          <CreateProjectDialog
            projects={projects}
            onClose={() => setCreatingProject(false)}
          />
        )}
        {settings ? (
          <Suspense fallback={<p role="status">正在打开设置…</p>}>
            <SettingsCenter
              key={settingsTarget}
              initialPage={settingsTarget}
              projects={projects}
              spaces={spaces}
              onOpenSession={openSession}
              workbench={workbench}
              plugins={plugins}
              theme={theme}
              setTheme={setTheme}
              onBack={() => setSettings(false)}
              appearance={
                <AppearanceSettings
                  theme={theme}
                  setTheme={setTheme}
                  appearance={appearance}
                  onBack={() => setSettings(false)}
                />
              }
            />
          </Suspense>
        ) : (
          <>
            {(overview || !session) && (
              <>
                <SplitHandle
                  collapsed={panel === "chat"}
                  onResize={setPanelWidth}
                  onCollapse={() => setPanel("chat")}
                  onExpand={() => setPanel(lastPanel.current)}
                />
                <aside
                  hidden={panel === "chat"}
                  className="context-panel desktop-right-panel"
                  aria-label="工作区预览"
                >
                  <ContextTabs
                    kind={panel}
                    onKind={setPanel}
                    expanded={expandedPanel}
                    onExpand={() => setExpandedPanel(!expandedPanel)}
                    renderTool={(item) => {
                      const target = currentProject
                        ? sessions.find((s) =>
                            currentProject.paths.includes(s.workspace),
                          )
                        : (session ?? sessions[0]);
                      return target ? (
                        <SessionTools
                          session={target}
                          workbench={workbench}
                          tab={item.kind}
                          act={act}
                          availableRunIds={[]}
                        />
                      ) : (
                        <p className="context-empty">
                          进入项目并选择一个 Agent 对话后即可使用此工具。
                        </p>
                      );
                    }}
                  />
                </aside>
              </>
            )}
            {overview && spaces.enabled && (
              <SpaceOverview
                projects={projects}
                project={currentProject}
                spaces={spaces}
                workbench={workbench}
                onEnter={enterProject}
                onSelect={openSession}
                onCreate={(kind) =>
                  kind === "project"
                    ? setCreatingProject(true)
                    : setSpaceEditor({ kind })
                }
                onCode={openCode}
              />
            )}
            {!session && !(overview && spaces.enabled) && (
              <section className="new-session-home">
                <BrandMark />
                <h1>开始新的工作</h1>
                <p>选择一个项目，或开启一段新的对话。</p>
                <button
                  className="desktop-button"
                  onClick={() => setCreating(true)}
                >
                  <Plus size={15} />
                  新建会话
                </button>
              </section>
            )}
            {session && !(overview && spaces.enabled) && (
              <Conversation
                spaceIdentity={agentIdentity}
                onEditIdentity={() => {
                  const p = projects.items.find(
                    (item) => item.id === agentIdentity?.projectId,
                  );
                  if (p) {
                    setSpaceId(p.id);
                    setSpaceEditor({
                      kind: "agent-update",
                      initial: agentIdentity,
                    });
                  }
                }}
                fixedIdentity={Boolean(agentIdentity?.steward)}
                spaces={spaces}
                thread={spaces.threadFor(session.id)}
                onOpenExecution={openSession}
                key={session.id}
                session={session}
                workbench={workbench}
                online={online}
                act={act}
                tab={creating ? "chat" : panel}
                setTab={setPanel}
                panelWidth={panelWidth}
                setPanelWidth={setPanelWidth}
                expandedPanel={expandedPanel}
                setExpandedPanel={setExpandedPanel}
                restorePanel={() => setPanel(lastPanel.current)}
              />
            )}
            {creating && (
              <NewSession
                key={newProject}
                projects={projects}
                initialProject={
                  newProject ||
                  projects.items.find(
                    (p) =>
                      session?.workspace &&
                      p.paths.includes(session.workspace),
                  )?.id
                }
                workbench={workbench}
                online={
                  online &&
                  (!workbench.device || workbench.device.role === "operator")
                }
                act={act}
                onCancel={() => setCreating(false)}
                onCreated={(id) => {
                  setOverview(false);
                  setSelected(id);
                  setCreating(false);
                  setShowList(false);
                }}
              />
            )}
          </>
        )}
      </ApprovedWorkbenchShell>
    </WorkspaceExtensions>
  );
}

function Conversation({
  session,
  workbench,
  online,
  act,
  thread,
  spaces,
  spaceIdentity,
  onEditIdentity,
  fixedIdentity,
  onOpenExecution,
  tab,
  setTab,
  panelWidth,
  setPanelWidth,
  expandedPanel,
  setExpandedPanel,
  restorePanel,
}: {
  session: DesktopSession;
  workbench: WorkbenchLike;
  online: boolean;
  act: ActRunner;
  thread?: SpaceThread;
  spaces: SpacesController;
  spaceIdentity?: SpaceAgent;
  onEditIdentity: () => void;
  fixedIdentity: boolean;
  onOpenExecution: (id: string) => void;
  tab: string;
  setTab: (tab: string) => void;
  panelWidth: number | null;
  setPanelWidth: (width: number) => void;
  expandedPanel: boolean;
  setExpandedPanel: (expanded: boolean) => void;
  restorePanel: () => void;
}) {
  const [draft, setDraft] = useState(() => {
    try {
      return localStorage.getItem(`vibeone-draft:${session.id}`) || "";
    } catch {
      return "";
    }
  });
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        if (draft) {
          localStorage.setItem(
            `vibeone-draft:${session.id}`,
            draft.slice(0, 32768),
          );
        } else {
          localStorage.removeItem(`vibeone-draft:${session.id}`);
        }
      } catch {
        // 忽略本地存储异常
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [draft, session.id]);

  const canOperate = !workbench.device || workbench.device.role === "operator";
  const canApprove =
    !workbench.device ||
    ["operator", "approver"].includes(workbench.device.role ?? "");

  const [editingTitle, setEditingTitle] = useState(false);
  const [browserRequest, setBrowserRequest] = useState<{
    url: string;
    key: string;
  } | null>(null);
  const [fileTarget, setFileTarget] = useState<{
    path: string;
    key: string;
  } | null>(null);
  const openUrl = useCallback(
    (url: string) => {
      setBrowserRequest({ url, key: crypto.randomUUID() });
      setTab("browser");
    },
    [setTab],
  );
  const [changeSummary, setChangeSummary] =
    useState<WorkspaceChangeSummary | null>(null);
  const [runChangesRequest, setRunChangesRequest] = useState<{
    snapshot: TurnChangesSnapshot;
    runId: string;
    key: string;
  } | null>(null);
  const lastRun = session.runs?.at(-1);
  const stopCurrentRun = useStopCommand(workbench, session);
  const queueCommands = useQueueCommands(workbench, session.id);
  const artifactCapture = useArtifactCapture(workbench, session.id);
  const metadataCommands = useMetadataCommands(workbench, session.id);

  useEffect(() => {
    let stale = false;
    let busy = false;
    setChangeSummary(null);
    const load = async () => {
      if (!online || busy) {
        return;
      }
      busy = true;
      try {
        const value = await workbench.call<WorkspaceChangeSummary>(
          `/sessions/${session.id}/changes`,
        );
        if (!stale) {
          setChangeSummary(value);
        }
      } catch {
        if (!stale) {
          setChangeSummary({ error: true, files: [] });
        }
      } finally {
        busy = false;
      }
    };
    void load();
    const timer =
      tab !== "chat" ? setInterval(() => void load(), 15000) : null;
    window.addEventListener("focus", load);
    return () => {
      stale = true;
      if (timer) {
        clearInterval(timer);
      }
      window.removeEventListener("focus", load);
    };
  }, [session.id, lastRun?.id, lastRun?.finishedAt, online, workbench.call, tab]);

  const openFile = useCallback(
    (path: string) => {
      setFileTarget({ path, key: crypto.randomUUID() });
      setTab("files");
    },
    [setTab],
  );
  const previewContext = useMemo(
    () => ({
      workspace: session.workspace,
      sessionId: session.id,
      read: workbench.read,
      openUrl,
      openFile,
    }),
    [session.workspace, session.id, workbench.read, openUrl, openFile],
  );

  const requestKey = useRef<string | null>(null);
  const attachmentInput = useRef<HTMLInputElement | null>(null);
  const composerActions = useRef<ComposerInputHandle | null>(null);
  const contextControl = useRef<HTMLDivElement | null>(null);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);

  useEffect(() => {
    if (!contextMenuOpen) {
      return;
    }
    const close = (event: PointerEvent | KeyboardEvent) => {
      if (event.type === "keydown" && (event as KeyboardEvent).key === "Escape") {
        setContextMenuOpen(false);
        contextControl.current?.querySelector<HTMLElement>("button")?.focus();
      } else if (
        event.type === "pointerdown" &&
        !contextControl.current?.contains(event.target as Node)
      ) {
        setContextMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [contextMenuOpen]);

  const [fileReferences, setFileReferences] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem(`vibeone-references:${session.id}`) || "[]",
      ) as unknown[];
      return Array.isArray(saved)
        ? saved
            .filter((item): item is string => typeof item === "string")
            .slice(0, 5)
        : [];
    } catch {
      return [];
    }
  });

  const changeReferences = (files: string[]) => {
    setFileReferences(files);
    requestKey.current = null;
    try {
      if (files.length) {
        localStorage.setItem(
          `vibeone-references:${session.id}`,
          JSON.stringify(files),
        );
      } else {
        localStorage.removeItem(`vibeone-references:${session.id}`);
      }
    } catch {
      // 忽略本地存储异常
    }
  };

  const [title, setTitle] = useState(session.title);
  const readOnly = Boolean(session.archived) || !canOperate;
  const [sending, setSending] = useState(false);
  const attachmentDraft = useAttachmentDraft({
    session,
    workbench,
    disabled: readOnly || sending,
    onMutate: () => {
      requestKey.current = null;
    },
  });
  const [deciding, setDeciding] = useState<string | null>(null);
  const timeline = useRef<HTMLDivElement | null>(null);
  const followLatest = useRef(true);
  const [following, setFollowing] = useState(true);
  const historyAnchor = useRef<HistoryAnchor | null>(null);

  const beforeHistoryMerge = useCallback(() => {
    if (!followLatest.current && !historyAnchor.current) {
      historyAnchor.current = captureHistoryAnchor(timeline.current);
    }
  }, []);

  const history = useConversationHistory({
    session,
    workbench,
    online,
    onBeforeMerge: beforeHistoryMerge,
  });

  const name =
    workbench.providers.find((provider) => provider.id === session.provider)
      ?.name ?? session.provider;
  const active =
    thread?.state === "running" ||
    ["starting", "running", "requires_action", "cancelling"].includes(
      session.status,
    );

  const locateRun = (runId: string) => {
    const root = timeline.current;
    if (!root) {
      return;
    }
    const target = [
      ...root.querySelectorAll<HTMLElement>("[data-turn-id]"),
    ].find((node) => node.dataset.turnId === runId);
    if (!target) {
      return;
    }
    followLatest.current = false;
    setFollowing(false);
    if (matchMedia("(max-width:800px)").matches) {
      setTab("chat");
    }
    requestAnimationFrame(() => {
      const scroller = timeline.current;
      if (!scroller) {
        return;
      }
      scroller.scrollTop +=
        target.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top -
        16;
      target.focus({ preventScroll: true });
    });
  };

  const contentLength = history.session.messages.reduce(
    (length, message) => length + (message.text?.length ?? 0),
    0,
  );
  const turns = useMemo(
    () => buildTurns(history.session),
    [
      history.session.messages,
      history.session.tools,
      session.runs,
      session.status,
    ],
  );

  useLayoutEffect(() => {
    if (historyAnchor.current) {
      restoreHistoryAnchor(timeline.current, historyAnchor.current);
      historyAnchor.current = null;
    } else if (followLatest.current && timeline.current) {
      timeline.current.scrollTop = timeline.current.scrollHeight;
    }
  }, [
    contentLength,
    history.session.messages,
    history.session.tools,
    session.approvals.length,
    session.inputs?.length,
    session.status,
  ]);

  const send = async () => {
    if (
      (!draft.trim() &&
        !fileReferences.length &&
        !attachmentDraft.items.length) ||
      (thread && active) ||
      attachmentDraft.busy ||
      sending ||
      !online ||
      readOnly
    ) {
      return;
    }
    const localPanel = commandPanel(draft, session.agentState?.commands);
    if (
      localPanel &&
      !fileReferences.length &&
      !attachmentDraft.items.length
    ) {
      setTab(localPanel);
      setDraft("");
      requestKey.current = null;
      return;
    }
    if (thread) {
      setSending(true);
      const result = await act(() =>
        groupReferenceText(
          workbench.read as Parameters<typeof groupReferenceText>[0],
          session.id,
          draft,
          fileReferences,
        ).then((text) =>
          spaces.command({
            action: "send",
            projectId: thread.projectId,
            id: thread.id,
            text,
            key: (requestKey.current ??= crypto.randomUUID()),
          }),
        ),
      );
      if (result) {
        setDraft("");
        changeReferences([]);
        requestKey.current = null;
      }
      setSending(false);
      return;
    }
    followLatest.current = true;
    setFollowing(true);
    setSending(true);
    const result = await act(() =>
      workbench.call(
        ...submitMessageCommand(
          session.id,
          draft,
          fileReferences,
          attachmentDraft.items.map((item) => item.id),
          (requestKey.current ??= crypto.randomUUID()),
        ),
      ),
    );
    if (result) {
      setDraft("");
      changeReferences([]);
      attachmentDraft.replace([]);
      requestKey.current = null;
    }
    setSending(false);
  };

  const decisionDeliveryLabels: Record<string, string> = {
    pending: "决定已记录，等待投递",
    sent: "已交给 ACP 响应通道",
    uncertain: "投递不确定，不自动重发",
  };

  return (
    <PreviewContext.Provider value={previewContext}>
      <div className="desktop-conversation-body">
        <div className="chat-column desktop-chat-column">
          <header className="chat-header desktop-conversation-heading">
            <div>
              {editingTitle ? (
                <form
                  className="desktop-title-form"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    const result = await metadataCommands.execute({ title });
                    if (result) {
                      setEditingTitle(false);
                    }
                  }}
                >
                  <input
                    aria-label="会话标题"
                    maxLength={120}
                    disabled={
                      !online ||
                      !canOperate ||
                      metadataCommands.busy ||
                      Boolean(metadataCommands.failure)
                    }
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                  <button
                    disabled={
                      !online ||
                      !canOperate ||
                      !title.trim() ||
                      metadataCommands.busy ||
                      Boolean(metadataCommands.failure)
                    }
                  >
                    保存标题
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingTitle(false)}
                  >
                    取消
                  </button>
                </form>
              ) : (
                <h1>{session.title}</h1>
              )}
              {metadataCommands.busy && (
                <p role="status">正在确认会话修改…</p>
              )}
              {metadataCommands.failure && (
                <div className="desktop-metadata-failure" role="alert">
                  <span>
                    {metadataCommands.failure.body.title !== undefined
                      ? `重命名为「${metadataCommands.failure.body.title}」`
                      : metadataCommands.failure.body.archived
                        ? "归档会话"
                        : "取消归档"}
                    未确认：{metadataCommands.failure.message}
                  </span>
                  <button
                    disabled={
                      !online || !canOperate || metadataCommands.busy
                    }
                    onClick={async () => {
                      const renaming =
                        metadataCommands.failure?.body.title !== undefined;
                      if ((await metadataCommands.retry()) && renaming) {
                        setEditingTitle(false);
                      }
                    }}
                  >
                    重试会话修改
                  </button>
                  <button
                    disabled={metadataCommands.busy}
                    onClick={metadataCommands.dismiss}
                  >
                    关闭会话修改提示
                  </button>
                </div>
              )}
              <span title={session.workspace}>
                <GitBranch size={12} />
                {changeSummary?.branch ??
                  session.workspace.split(/[\\/]/).filter(Boolean).at(-1)}
                <i className="header-divider" />
                {name}
                <i className="online-dot" />
                <span
                  className={`desktop-status ${session.status === "requires_action" || session.inputs?.length ? "attention" : ""}`}
                >
                  {active ? (
                    <LoaderCircle
                      size={13}
                      className={
                        session.status === "requires_action" ||
                        session.inputs?.length
                          ? ""
                          : "desktop-spin"
                      }
                    />
                  ) : ["error", "disconnected"].includes(session.status) ? (
                    <X size={13} />
                  ) : (
                    <Check size={13} />
                  )}
                  {sessionLabel(session)}
                </span>
              </span>
            </div>
            {spaceIdentity && !fixedIdentity && (
              <button
                className="icon-button"
                aria-label="编辑 Agent"
                onClick={onEditIdentity}
              >
                <Settings2 size={15} />
              </button>
            )}
            {workbench.persistent && !spaceIdentity && !thread && (
              <details className="workbench-tool-menu session-action-menu">
                <summary
                  className="icon-button"
                  aria-label="会话操作"
                  title="会话操作"
                >
                  <MoreHorizontal size={16} />
                </summary>
                <div>
                  <button
                    aria-label="重命名"
                    title="重命名"
                    disabled={
                      !online ||
                      !canOperate ||
                      metadataCommands.busy ||
                      Boolean(metadataCommands.failure)
                    }
                    onClick={(event) => {
                      const details = event.currentTarget.closest("details");
                      if (details) {
                        details.open = false;
                      }
                      setTitle(session.title);
                      setEditingTitle(true);
                    }}
                  >
                    重命名
                  </button>
                  <button
                    aria-label={session.archived ? "取消归档" : "归档"}
                    title={session.archived ? "取消归档" : "归档"}
                    disabled={
                      !online ||
                      !canOperate ||
                      active ||
                      metadataCommands.busy ||
                      Boolean(metadataCommands.failure)
                    }
                    onClick={(event) => {
                      const details = event.currentTarget.closest("details");
                      if (details) {
                        details.open = false;
                      }
                      void metadataCommands.execute({
                        archived: !session.archived,
                      });
                    }}
                  >
                    {session.archived ? "取消归档" : "归档"}
                  </button>
                  {session.historyOnly &&
                    !session.archived &&
                    canOperate &&
                    !(session.queue ?? []).length && (
                      <button
                        disabled={!online || sending}
                        onClick={async (event) => {
                          const details =
                            event.currentTarget.closest("details");
                          if (details) {
                            details.open = false;
                          }
                          setSending(true);
                          await queueCommands.execute({
                            resume: true,
                            freshContext: true,
                          });
                          setSending(false);
                        }}
                      >
                        新开 Agent 上下文
                      </button>
                    )}
                </div>
              </details>
            )}
          </header>

          <div className="chat-reading desktop-timeline-shell">
            <div
              className="chat-scroll desktop-timeline"
              ref={timeline}
              onScroll={(event) => {
                const element = event.currentTarget;
                const nearBottom =
                  element.scrollHeight -
                    element.scrollTop -
                    element.clientHeight <
                  56;
                followLatest.current = nearBottom;
                setFollowing(nearBottom);
              }}
            >
              <div className="conversation">
                {history.enabled && (
                  <div
                    className="desktop-history-controls"
                    aria-label="历史记录"
                  >
                    {(history.hasMore || !history.ready) && (
                      <button
                        type="button"
                        className="desktop-text-action"
                        disabled={!online || history.busy}
                        onClick={() => {
                          followLatest.current = false;
                          setFollowing(false);
                          void (history.ready
                            ? history.loadOlder()
                            : history.retry());
                        }}
                      >
                        {history.busy
                          ? "正在读取历史…"
                          : history.ready
                            ? "加载更早记录"
                            : "读取历史记录"}
                      </button>
                    )}
                    {history.error && (
                      <p role="alert">
                        历史加载失败：{history.error}{" "}
                        <button
                          type="button"
                          className="desktop-text-action"
                          disabled={!online || history.busy}
                          onClick={() => void history.retry()}
                        >
                          重试
                        </button>
                      </p>
                    )}
                    {history.warnings.map((warning) => (
                      <p key={warning}>{warning}</p>
                    ))}
                  </div>
                )}
                {!history.enabled &&
                  (session.messages.length >= 128 ||
                    session.tools.length >= 100) && (
                    <p className="desktop-history-notice">
                      当前主机仅提供最近记录。请在任务结束后到设置重启主机，以启用完整历史。
                    </p>
                  )}
                {!history.session.messages.length && (
                  <div className="desktop-chat-empty">
                    <MessageSquare size={26} />
                    <h2>会话已准备好</h2>
                    <p>
                      {session.provider === "demo"
                        ? "发送任意消息体验流式响应；/approve 体验审批，/wait 体验停止。"
                        : `发送任务后将启动 ${name}。请先在本机完成该工具的认证。`}
                    </p>
                  </div>
                )}
                {thread ? (
                  <GroupTranscript
                    thread={thread}
                    session={history.session}
                    workbench={workbench}
                    spaces={spaces}
                    act={act}
                    onOpenExecution={onOpenExecution}
                  />
                ) : (
                  turns.map((turn) => (
                    <div
                      className="conversation-round desktop-turn"
                      tabIndex={-1}
                      key={turn.id}
                      data-turn-id={turn.id}
                    >
                      {turn.user && (
                        <ChatMessage message={turn.user} name={name} />
                      )}
                      <AgentResponse
                        onChanges={(snapshot, runId) => {
                          setRunChangesRequest({
                            snapshot,
                            runId,
                            key: crypto.randomUUID(),
                          });
                          setTab("run-changes");
                        }}
                        turn={turn}
                        name={name}
                        status={session.status}
                        hasInput={Boolean(session.inputs?.length)}
                        onReadHistory={() => {
                          followLatest.current = false;
                          setFollowing(false);
                        }}
                      />
                    </div>
                  ))
                )}
                {(session.inputs ?? []).map((request) => (
                  <InputRequest
                    key={request.id}
                    request={request}
                    session={session}
                    workbench={workbench}
                    online={online && canOperate}
                    act={act}
                  />
                ))}
                {Boolean(session.decisions?.length) && (
                  <details className="desktop-tools">
                    <summary>人工处理回执</summary>
                    {session.decisions?.slice(-10).map((decision) => {
                      const answer =
                        decision.answer &&
                        typeof decision.answer === "object" &&
                        !Array.isArray(decision.answer)
                          ? (decision.answer as { action?: string })
                          : null;
                      return (
                        <p key={decision.id}>
                          {decision.option
                            ? `审批选择：${decision.option}`
                            : `补充输入：${answer?.action ?? "已提交"}`}{" "}
                          ·{" "}
                          {decisionDeliveryLabels[decision.delivery] ??
                            decision.delivery}
                        </p>
                      );
                    })}
                  </details>
                )}
                {session.approvals.map((approval) => (
                  <section className="desktop-approval" key={approval.id}>
                    <h2>
                      <ShieldCheck size={18} />
                      {approval.title}
                    </h2>
                    {approval.description ? <p>{approval.description}</p> : null}
                    {approval.subject ? (
                      <pre>{JSON.stringify(approval.subject, null, 2)}</pre>
                    ) : null}
                    <div className="desktop-approval-actions">
                      {(approval.options ?? []).map((option) => (
                        <button
                          key={option.optionId}
                          className={`desktop-button ${option.kind.startsWith("allow") ? "primary" : ""}`}
                          disabled={
                            !online ||
                            !canApprove ||
                            deciding === approval.id ||
                            session.status === "cancelling"
                          }
                          onClick={async () => {
                            setDeciding(approval.id);
                            await act(() =>
                              workbench.call(
                                `/sessions/${session.id}/approvals/${approval.id}`,
                                { option: option.optionId },
                              ),
                            );
                            setDeciding(null);
                          }}
                        >
                          {option.name}
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
                {session.error ? (
                  <div className="desktop-run-error" role="alert">
                    <strong>连接或执行未完成</strong>
                    <pre>{session.error}</pre>
                    <p>请检查本机工具认证和网络，或新建会话重试。</p>
                  </div>
                ) : null}
                {session.stopReason ? (
                  <p
                    className={`desktop-turn-end ${session.stopReason === "end_turn" ? "visually-hidden" : ""}`}
                    role="status"
                  >
                    {session.stopReason === "cancelled"
                      ? "本轮已停止"
                      : session.stopReason === "end_turn"
                        ? "本轮执行结束"
                        : `本轮已结束 · ${session.stopReason}`}
                  </p>
                ) : null}
              </div>
            </div>
            <ConversationNav
              turns={turns}
              timeline={timeline}
              onNavigate={() => {
                followLatest.current = false;
                setFollowing(false);
              }}
            />
          </div>

          <div className="composer-area desktop-composer-wrap">
            {!following && (
              <div className="desktop-jump">
                <button
                  className="jump-latest"
                  aria-label="回到最新消息"
                  title="回到最新消息"
                  onClick={() => {
                    followLatest.current = true;
                    setFollowing(true);
                    if (timeline.current) {
                      timeline.current.scrollTop =
                        timeline.current.scrollHeight;
                    }
                  }}
                >
                  <ArrowDown size={18} strokeWidth={1.8} />
                </button>
              </div>
            )}

            <div
              className="composer desktop-composer"
              onPaste={attachmentDraft.onPaste}
              onDrop={attachmentDraft.onDrop}
              onDragOver={attachmentDraft.onDragOver}
            >
              {!thread && (
                <AttachmentPicker
                  inputRef={attachmentInput}
                  draft={attachmentDraft}
                  disabled={readOnly || sending}
                  supported={workbench.features?.includes("attachments")}
                />
              )}
              <Queue
                commands={queueCommands}
                session={session}
                workbench={workbench}
                online={online && canOperate}
              />
              <ComposerInput
                configTargets={
                  thread
                    ? spaces.agents
                        .filter((a) => thread.members.includes(a.id))
                        .map((a) => ({
                          name: a.name,
                          session: workbench.sessions.find(
                            (s) => s.id === thread.bindings?.[a.id],
                          ),
                        }))
                        .filter((a) => Boolean(a.session))
                    : []
                }
                group={Boolean(thread)}
                agents={spaces.agents.filter((a) =>
                  thread
                    ? thread.members.includes(a.id)
                    : a.projectId === spaceIdentity?.projectId ||
                      (!spaceIdentity && a.workspace === session.workspace),
                )}
                inputActions={composerActions}
                session={session}
                workbench={workbench}
                value={draft}
                onChange={(text) => {
                  setDraft(text);
                  requestKey.current = null;
                }}
                files={fileReferences}
                onFiles={changeReferences}
                onSubmit={() => void send()}
                onPanel={setTab}
                disabled={readOnly || sending || (Boolean(thread) && active)}
                online={online}
                placeholder={
                  !canOperate
                    ? "此设备仅可查看或审批，不能发送任务"
                    : readOnly
                      ? "先取消归档后继续会话"
                      : active
                        ? "当前正在执行，发送后加入下一轮队列…"
                        : "描述任务，输入 / 选择指令，@ 选择 Agent 或引用文件…"
                }
              />
              <div className="composer-toolbar desktop-composer-toolbar">
                <div>
                  <div className="composer-context-control" ref={contextControl}>
                    <IconButton
                      label="添加上下文"
                      disabled={
                        readOnly || sending || (Boolean(thread) && active)
                      }
                      onClick={() => setContextMenuOpen(!contextMenuOpen)}
                    >
                      <Plus size={19} />
                    </IconButton>
                    {contextMenuOpen && (
                      <div className="composer-context-actions">
                        <button
                          type="button"
                          aria-label="添加附件"
                          disabled={
                            Boolean(thread) ||
                            !workbench.features?.includes("attachments") ||
                            !online ||
                            attachmentDraft.busy
                          }
                          onClick={() => {
                            setContextMenuOpen(false);
                            attachmentInput.current?.click();
                          }}
                        >
                          <Paperclip size={14} />
                          添加附件
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setContextMenuOpen(false);
                            composerActions.current?.trigger("/");
                          }}
                        >
                          <Slash size={14} />
                          选择指令
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setContextMenuOpen(false);
                            composerActions.current?.trigger("@");
                          }}
                        >
                          <AtSign size={14} />
                          提及 Agent / 引用上下文
                        </button>
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    className="permission"
                    onClick={() => setTab("agent")}
                  >
                    <ShieldCheck size={13} />
                    会话权限
                    <ChevronDown size={11} />
                  </button>
                </div>
                <div>
                  {thread ? (
                    <span className="space-group-label">
                      <Users size={13} /> {thread.members.length} 位成员
                    </span>
                  ) : (
                    <AgentConfigControls
                      session={session}
                      workbench={workbench}
                      compact
                      label={name}
                      onOpen={() => setTab("agent")}
                    />
                  )}
                  <button
                    className="send-button desktop-send"
                    aria-label="发送消息"
                    disabled={
                      readOnly ||
                      (!draft.trim() &&
                        !fileReferences.length &&
                        !attachmentDraft.items.length) ||
                      attachmentDraft.busy ||
                      sending ||
                      !online ||
                      (Boolean(thread) && active) ||
                      session.status === "disconnected"
                    }
                    onClick={() => void send()}
                  >
                    {sending ? (
                      <LoaderCircle size={16} className="desktop-spin" />
                    ) : (
                      <ArrowUp size={17} />
                    )}
                  </button>
                </div>
              </div>
            </div>
            {["failed", "interrupted"].includes(lastRun?.status ?? "") &&
              (lastRun?.text ||
                lastRun?.files?.length ||
                lastRun?.attachments?.length) && (
                <button
                  className="desktop-text-action"
                  disabled={readOnly || sending || attachmentDraft.busy}
                  onClick={() => {
                    const runText = lastRun?.text ?? "";
                    setDraft((previous) =>
                      previous.trim() ? `${previous}\n\n${runText}` : runText,
                    );
                    changeReferences(
                      [
                        ...new Set([
                          ...fileReferences,
                          ...(lastRun?.files ?? []),
                        ]),
                      ].slice(0, 5),
                    );
                    attachmentDraft.replace(
                      [
                        ...new Map(
                          [
                            ...attachmentDraft.items,
                            ...(lastRun?.attachments ?? []),
                          ].map((item) => [item.id, item]),
                        ).values(),
                      ].slice(0, 5),
                    );
                  }}
                >
                  恢复失败任务到输入框（不会自动发送）
                </button>
              )}
            <div className="composer-caption desktop-composer-footer">
              <span>Enter 发送 · Shift+Enter 换行</span>
              {active ? (
                <button
                  disabled={
                    !online ||
                    !canOperate ||
                    session.status === "cancelling"
                  }
                  onClick={() =>
                    void act(
                      thread
                        ? () =>
                            spaces.command({
                              action: "stop",
                              projectId: thread.projectId,
                              id: thread.id,
                            })
                        : stopCurrentRun,
                    )
                  }
                >
                  <Square size={11} />
                  {session.status === "cancelling" ? "正在停止" : "停止执行"}
                </button>
              ) : (
                <span>
                  {session.historyOnly
                    ? "会话已保存到本机"
                    : workbench.persistent
                      ? "会话已保存到本机"
                      : "本次主机运行期间保留会话"}
                </span>
              )}
            </div>
          </div>
        </div>
        <SplitHandle
          collapsed={tab === "chat"}
          onExpand={restorePanel}
          onResize={(width) => {
            setExpandedPanel(false);
            setPanelWidth(width);
          }}
          onCollapse={() => setTab("chat")}
        />
        <aside
          hidden={tab === "chat"}
          style={
            {
              display: tab === "chat" ? "none" : undefined,
              ...(expandedPanel
                ? { "--panel-width": "min(70%, 1100px)" }
                : panelWidth
                  ? { "--panel-width": `${panelWidth}px` }
                  : {}),
            } as React.CSSProperties
          }
          className={`context-panel desktop-right-panel ${expandedPanel ? "expanded-preview" : ""}`}
          aria-label="工作区预览"
        >
          <ContextTabs
            overview={
              <WorkspaceChangeOverview
                summary={changeSummary}
                onOpen={() => setTab("changes")}
              />
            }
            runChangesRequest={runChangesRequest}
            kind={tab}
            onKind={setTab}
            fileRequest={fileTarget}
            browserRequest={browserRequest}
            expanded={expandedPanel}
            onExpand={() => setExpandedPanel(!expandedPanel)}
            renderTool={(item, onTitle) =>
              item.changeSnapshot ? (
                <RunChanges snapshot={item.changeSnapshot} />
              ) : (
                <SessionTools
                  artifactCapture={artifactCapture}
                  session={history.session}
                  workbench={workbench}
                  tab={item.kind}
                  act={act}
                  fileTarget={item.file}
                  onTitle={onTitle}
                  onLocateRun={locateRun}
                  availableRunIds={turns.map((turn) => turn.id)}
                />
              )
            }
          />
        </aside>
      </div>
    </PreviewContext.Provider>
  );
}

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(
    isNative() ? (
      <App />
    ) : (
      <PhoneGate>
        <App />
      </PhoneGate>
    ),
  );
}
