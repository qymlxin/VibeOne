import React, { useEffect, useId, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Folder,
  FolderOpen,
  LoaderCircle,
  Plus,
  RefreshCw,
  Settings2,
  SlidersHorizontal,
  Terminal,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  createSession as createSessionCommand,
  type CreateSessionResponse,
  type SnapshotResponse,
} from "@vibeone/client-contracts";
import type { AgentConfigOptionInput } from "./agent-config.ts";
import { chooseWorkspace, isNative } from "./api.ts";
import {
  avatarColors,
  avatarShapeNames,
  avatarShapes,
  SessionAvatar,
} from "./SessionIdentity.tsx";
import {
  isModelOption,
  modelOptions,
  savedModelOption,
} from "./session-models.ts";
import type {
  ActRunner,
  ProjectsController,
  WorkbenchLike,
} from "./types.ts";
import "./new-session.css";

const basename = (path?: string): string =>
  path?.split(/[\\/]/).filter(Boolean).at(-1) ?? "";

export interface ChoiceOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export function Choice({
  label,
  value,
  options,
  onChange,
  icon: Icon = Folder,
  up = false,
  disabled = false,
  onOpen,
}: {
  label: string;
  value: string;
  options: ChoiceOption[];
  onChange: (value: string) => void;
  icon?: LucideIcon;
  up?: boolean;
  disabled?: boolean;
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const id = useId();
  const current = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) {
      return;
    }
    const outside = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", outside);
    root.current
      ?.querySelector<HTMLElement>("[role=option][aria-selected=true]:not(:disabled)")
      ?.focus();
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  return (
    <div
      ref={root}
      className={`new-choice ${up ? "opens-up" : ""}`}
      onKeyDown={(event) => {
        if (open && event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
        if (
          open &&
          ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
        ) {
          event.preventDefault();
          const items = [
            ...(root.current?.querySelectorAll<HTMLElement>(
              "[role=option]:not(:disabled)",
            ) ?? []),
          ];
          const index = items.indexOf(document.activeElement as HTMLElement);
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? items.length - 1
                : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
                  items.length;
          items[next]?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        className="new-choice-trigger"
        type="button"
        disabled={disabled}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? id : undefined}
        onClick={() => {
          if (!open) {
            onOpen?.();
          }
          setOpen(!open);
        }}
        onKeyDown={(event) => {
          if (["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            onOpen?.();
            setOpen(true);
          }
        }}
      >
        <Icon size={17} />
        <span>
          <strong>{current?.label ?? "请选择"}</strong>
          {current?.description && (
            <small title={current.description}>{current.description}</small>
          )}
        </span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div
          id={id}
          className="new-choice-menu"
          role="listbox"
          aria-label={label}
        >
          {options.map((option) => (
            <button
              type="button"
              role="option"
              aria-selected={option.value === value}
              disabled={option.disabled}
              key={option.value}
              onClick={() => {
                onChange(option.value);
                close();
              }}
            >
              <span>
                <strong>{option.label}</strong>
                {option.description && (
                  <small title={option.description}>
                    {option.description}
                  </small>
                )}
              </span>
              {option.disabled ? (
                <small>未安装</small>
              ) : (
                option.value === value && <Check size={14} />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function NewSession({
  workbench,
  online,
  act,
  onCreated,
  projects,
  initialProject,
  onCancel,
}: {
  workbench: WorkbenchLike;
  online: boolean;
  act: ActRunner;
  onCreated: (sessionId: string) => void;
  projects: ProjectsController;
  initialProject?: string;
  onCancel?: () => void;
}) {
  const [agentName, setAgentName] = useState("");
  const [projectId, setProjectId] = useState(initialProject ?? "");
  const project = projects.items.find((p) => p.id === projectId);
  const creation = useRef<{
    signature: string;
    key: string;
    busy: boolean;
  } | null>(null);
  const [workspace, setWorkspace] = useState(
    () =>
      projects.items.find((p) => p.id === initialProject)?.paths[0] ?? "",
  );
  const [provider, setProvider] = useState("codex");
  const [busy, setBusy] = useState(false);
  const [details, setDetails] = useState(false);
  const dialog = useRef<HTMLDialogElement | null>(null);
  const modelEpoch = useRef(0);
  const [avatar, setAvatar] = useState({ color: "#347DE1", shape: "circle" });
  const [avatarTab, setAvatarTab] = useState<"color" | "shape">("color");
  const [catalog, setCatalog] = useState<AgentConfigOptionInput[] | null>(null);
  const [model, setModel] = useState("");
  const [modelsBusy, setModelsBusy] = useState(false);
  const [modelError, setModelError] = useState("");

  const profile = (workbench.profiles ?? []).find(
    (item) => item.id === provider,
  );
  const selected = workbench.providers.find(
    (item) => item.id === (profile?.provider ?? provider),
  );
  const available = Boolean(selected?.available || profile?.command);
  const native = isNative();
  const providerId = profile?.provider ?? provider;
  const historical = savedModelOption(
    workbench.sessions,
    providerId,
    profile?.id,
  );
  const modelOption =
    catalog !== null ? catalog.find(isModelOption) : historical;
  const choices = modelOptions(modelOption);
  const canReadModels =
    online &&
    available &&
    !workbench.device &&
    !providerId.includes(":") &&
    Boolean(workbench.features?.includes("providerModels"));
  const canSetModel = Boolean(
    workbench.features?.includes("initialSessionModel"),
  );

  useEffect(() => {
    const node = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    node?.showModal();
    node?.querySelector<HTMLElement>('[aria-label="项目"]')?.focus();
    return () => {
      node?.close();
      if (previous?.isConnected) {
        previous.focus();
      }
    };
  }, []);

  useEffect(() => {
    modelEpoch.current++;
    setCatalog(null);
    setModel("");
    setModelError("");
    setModelsBusy(false);
    return () => {
      modelEpoch.current++;
    };
  }, [provider, profile?.revision, workspace]);

  async function readModels() {
    if (!canReadModels || modelsBusy) {
      return;
    }
    const epoch = ++modelEpoch.current;
    setModelsBusy(true);
    setModelError("");
    try {
      const result = await workbench.call<{
        configOptions?: AgentConfigOptionInput[];
      }>(`/providers/${encodeURIComponent(providerId)}/models`, {
        profileId: profile?.id,
        workspace,
      });
      if (epoch === modelEpoch.current) {
        setCatalog(result.configOptions ?? []);
        setModel("");
      }
    } catch (error) {
      if (epoch === modelEpoch.current) {
        setModelError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (epoch === modelEpoch.current) {
        setModelsBusy(false);
      }
    }
  }

  const pickDirectory = async () => {
    const chosen = await act(chooseWorkspace);
    if (chosen) {
      setWorkspace(chosen);
    }
  };

  const changeProject = (value: string) => {
    setProjectId(value);
    setWorkspace(projects.items.find((p) => p.id === value)?.paths[0] ?? "");
  };

  const authorizedDirectory =
    !workbench.device ||
    (workbench.workspaces ?? []).some((item) => item.path === workspace);
  const canCreate =
    (!workbench.features?.includes("projectSpaces") ||
      Boolean(agentName.trim())) &&
    online &&
    authorizedDirectory &&
    (!workbench.device || Boolean(workspace.trim())) &&
    !busy &&
    available;

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canCreate || creation.current?.busy) {
      return;
    }
    const initialModel =
      model && canSetModel && modelOption?.configId
        ? { id: modelOption.configId, value: model }
        : undefined;
    const signature = JSON.stringify([
      providerId,
      workspace,
      profile?.id ?? null,
      initialModel ?? null,
    ]);
    if (creation.current?.signature !== signature) {
      creation.current = {
        signature,
        key: crypto.randomUUID(),
        busy: false,
      };
    }
    const intent = creation.current;
    intent.busy = true;
    setBusy(true);
    try {
      const result = await act(() =>
        workbench.call<CreateSessionResponse>(
          ...createSessionCommand(
            profile?.provider ?? provider,
            workspace,
            profile?.id,
            workbench.features?.includes("sessionCreationIdempotency")
              ? intent.key
              : undefined,
            initialModel,
          ),
        ),
      );
      if (result) {
        if (agentName.trim()) {
          const named = await act(() =>
            workbench.call(`/sessions/${result.id}/metadata`, {
              title: agentName.trim(),
            }),
          );
          if (!named) {
            return;
          }
        }
        if (project) {
          const snapshot = await workbench.call<SnapshotResponse>("/snapshot");
          const created = snapshot.sessions.find((s) => s.id === result.id);
          if (created && !project.paths.includes(created.workspace)) {
            const saved = await act(() =>
              projects.save({ id: project.id, addPath: created.workspace }),
            );
            if (!saved) {
              return;
            }
          }
        }
        await projects.reload();
        try {
          localStorage.setItem(
            `vibeone-avatar:${result.id}`,
            JSON.stringify(avatar),
          );
        } catch {
          // 忽略本地存储异常
        }
        creation.current = null;
        onCreated(result.id);
      }
    } finally {
      intent.busy = false;
      setBusy(false);
    }
  };

  const projectOptions: ChoiceOption[] = [
    {
      value: "",
      label: "自动选择项目",
      description: "按工作目录归入项目，或自动创建",
    },
    ...projects.items.map((p) => ({
      value: p.id,
      label: p.name,
      description: `${p.paths.length} 个工作目录`,
    })),
  ];

  const directoryOptions: ChoiceOption[] = [
    {
      value: "",
      label: workbench.device
        ? "选择已授权目录"
        : project
          ? "新建工作目录"
          : "自动创建工作目录",
      description: workbench.device
        ? "仅显示当前设备可访问的位置"
        : "创建会话时准备好工作空间",
    },
    ...(workbench.device
      ? (workbench.workspaces ?? []).map((w) => w.path)
      : (project?.paths ?? (workbench.workspaces ?? []).map((w) => w.path))
    )
      .filter((path, index, paths) => paths.indexOf(path) === index)
      .map((path) => ({
        value: path,
        label: basename(path),
        description: path,
      })),
  ];

  if (
    !workbench.device &&
    workspace &&
    !directoryOptions.some((option) => option.value === workspace)
  ) {
    directoryOptions.push({
      value: workspace,
      label: basename(workspace),
      description: workspace,
    });
  }

  const agentOptions: ChoiceOption[] = [
    ...workbench.providers.map((item) => ({
      value: item.id,
      label: item.name,
      description: item.available ? "本机工具已就绪" : "安装后即可使用",
      disabled: !item.available,
    })),
    ...(workbench.profiles ?? []).map((item) => ({
      value: item.id,
      label: item.name,
      description: `${workbench.providers.find((p) => p.id === item.provider)?.name ?? item.provider} · 自定义配置`,
    })),
  ];

  return (
    <dialog
      ref={dialog}
      className="new-session-dialog"
      aria-labelledby="new-session-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) {
          onCancel?.();
        }
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget || busy) {
          return;
        }
        const box = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < box.left ||
          event.clientX > box.right ||
          event.clientY < box.top ||
          event.clientY > box.bottom
        ) {
          onCancel?.();
        }
      }}
    >
      <form className="new-session-form" onSubmit={create} aria-busy={busy}>
        <header className="new-session-form-heading">
          <h1 id="new-session-title">新建会话</h1>
          <button
            type="button"
            className="new-session-close"
            aria-label="关闭新建会话"
            disabled={busy}
            onClick={onCancel}
          >
            <X size={17} />
          </button>
        </header>
        <div className="new-avatar-setting">
          <SessionAvatar {...avatar} />
          <div className="new-avatar-options">
            <div className="new-avatar-tabs">
              <span>会话图标</span>
              <button
                type="button"
                disabled={busy}
                aria-pressed={avatarTab === "color"}
                onClick={() => setAvatarTab("color")}
              >
                颜色
              </button>
              <button
                type="button"
                disabled={busy}
                aria-pressed={avatarTab === "shape"}
                onClick={() => setAvatarTab("shape")}
              >
                形状
              </button>
            </div>
            {avatarTab === "color" ? (
              <div className="new-avatar-colors">
                {avatarColors.map((color) => (
                  <button
                    type="button"
                    disabled={busy}
                    key={color}
                    aria-label={`图标颜色 ${color}`}
                    aria-pressed={avatar.color === color}
                    onClick={() =>
                      setAvatar((val) => ({ ...val, color }))
                    }
                  >
                    <span style={{ background: color }} />
                  </button>
                ))}
              </div>
            ) : (
              <div className="new-avatar-shapes">
                {avatarShapes.map((shape, index) => (
                  <button
                    type="button"
                    disabled={busy}
                    key={shape}
                    aria-label={`图标形状 ${avatarShapeNames[index]}`}
                    aria-pressed={avatar.shape === shape}
                    onClick={() =>
                      setAvatar((val) => ({ ...val, shape }))
                    }
                  >
                    <SessionAvatar color={avatar.color} shape={shape} />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <fieldset disabled={busy} aria-label="会话配置">
          {workbench.features?.includes("projectSpaces") && (
            <div className="new-session-row">
              <label htmlFor="agent-name">Agent 名称</label>
              <input
                id="agent-name"
                className="new-agent-name"
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                maxLength={100}
                required
                placeholder="给这位 Agent 起一个名字"
              />
            </div>
          )}
          <div className="new-session-row">
            <label>项目</label>
            <Choice
              label="项目"
              value={projectId}
              options={projectOptions}
              onChange={changeProject}
            />
          </div>
          <div className="new-session-row">
            <label>工作目录</label>
            <div className="new-directory-control">
              <Choice
                label="工作目录"
                value={workspace}
                options={directoryOptions}
                onChange={setWorkspace}
                icon={FolderOpen}
              />
              {native && (
                <button
                  type="button"
                  className="new-directory-browse"
                  aria-label="选择工作区目录"
                  title="从本机选择目录"
                  onClick={() => void pickDirectory()}
                >
                  <FolderOpen size={17} />
                </button>
              )}
            </div>
          </div>
          <div className="new-session-row new-session-agent">
            <label>Agent</label>
            <div className="new-agent-control">
              <Choice
                label="Agent"
                value={provider}
                options={
                  agentOptions.length
                    ? agentOptions
                    : [
                        {
                          value: "codex",
                          label: "正在读取工具",
                          description: "连接工作主机后继续",
                          disabled: true,
                        },
                      ]
                }
                onChange={setProvider}
                icon={Terminal}
                up
              />
              <span
                className={`new-agent-status ${available ? "available" : ""}`}
              >
                <i />
                {available ? "已就绪" : "待配置"}
              </span>
            </div>
          </div>
          <div className="new-session-row">
            <label>模型</label>
            <div className="new-model-control">
              <Choice
                label="模型"
                icon={SlidersHorizontal}
                value={model}
                options={[
                  {
                    value: "",
                    label: "使用 Agent 默认模型",
                    description: modelsBusy
                      ? "正在读取可用模型…"
                      : !canSetModel
                        ? "请重启主机启用模型选择"
                        : choices.length
                          ? undefined
                          : "读取模型列表后可选择",
                  },
                  ...choices,
                ]}
                onChange={setModel}
                onOpen={() => {
                  if (catalog === null && !choices.length) {
                    void readModels();
                  }
                }}
                up
                disabled={!canSetModel}
              />
              {canReadModels && (
                <button
                  type="button"
                  className="new-directory-browse"
                  aria-label="读取模型列表"
                  title="从 Agent 读取模型列表"
                  disabled={modelsBusy || busy}
                  onClick={() => void readModels()}
                >
                  {modelsBusy ? (
                    <LoaderCircle size={15} className="desktop-spin" />
                  ) : (
                    <RefreshCw size={15} />
                  )}
                </button>
              )}
            </div>
          </div>
        </fieldset>
        {modelError && (
          <p className="new-model-notice" role="alert">
            {modelError}，可重试或使用默认模型。
          </p>
        )}
        {!modelError && catalog && choices.length === 0 && (
          <p className="new-model-notice">
            Agent 未提供可选模型，将使用默认设置。
          </p>
        )}
        <div className="new-session-extra">
          <button
            type="button"
            aria-expanded={details}
            aria-controls="new-session-details"
            onClick={() => setDetails(!details)}
          >
            <Settings2 size={14} />
            更多选项
            <ChevronDown size={12} />
          </button>
          {details && (
            <div id="new-session-details" className="new-session-details">
              {native && (
                <label htmlFor="workspace">
                  自定义工作目录
                  <div className="new-directory-input">
                    <input
                      id="workspace"
                      value={workspace}
                      disabled={busy}
                      onChange={(event) => setWorkspace(event.target.value)}
                      placeholder="留空，自动创建工作目录"
                      list="new-saved-workspaces"
                    />
                    {workspace && (
                      <button
                        type="button"
                        disabled={busy}
                        aria-label="清空工作目录"
                        onClick={() => setWorkspace("")}
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                  <datalist id="new-saved-workspaces">
                    {(workbench.workspaces ?? []).map((item) => (
                      <option value={item.path} key={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </datalist>
                </label>
              )}
              <div className="new-agent-description">
                <strong>{selected?.name ?? "Agent"} 工具信息</strong>
                <p>
                  {selected?.description ?? "连接工作主机后读取工具信息。"}
                </p>
              </div>
            </div>
          )}
        </div>
        <footer className="new-session-actions">
          <span>
            {!online
              ? "等待工作主机连接"
              : workbench.device && (!workspace.trim() || !authorizedDirectory)
                ? "请选择已授权的工作目录"
                : !available
                  ? "请先配置可用的 Agent"
                  : model
                    ? "模型将在首次连接时应用"
                    : "发送消息后才开始执行"}
          </span>
          <button
            type="submit"
            className="new-session-create"
            disabled={!canCreate}
          >
            {busy ? (
              <LoaderCircle size={16} className="desktop-spin" />
            ) : (
              <Plus size={16} />
            )}
            <span>{busy ? "正在创建…" : "创建会话"}</span>
            {!busy && <ArrowRight size={15} />}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
