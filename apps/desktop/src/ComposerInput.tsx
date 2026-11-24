import React, {
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  File,
  Folder,
  RefreshCw,
  X,
} from "lucide-react";
import { configureAgent } from "@vibeone/client-contracts";
import { canConfigure, configChoices } from "./agent-config.ts";
import {
  commandOptions,
  composerToken,
  configCategory,
  referenceOptions,
  referenceRequest,
  replaceToken,
  type ComposerEntry,
  type ComposerSkillItem,
  type ComposerToken,
} from "./composer.ts";
import {
  discoverComposerSkills,
  type DiscoveredSkill,
} from "./composer-skills.ts";
import {
  ComposerOptionIcon,
  type ComposerOptionItem,
} from "./ComposerOptionIcon.tsx";
import type { DesktopSession, SpaceAgent, WorkbenchLike } from "./types.ts";
import "./composer.css";

interface ReferenceListing {
  sessionId: string;
  query: string;
  mode: "directory" | "search";
  truncated?: boolean;
  entries: Array<ComposerEntry & { path: string }>;
}

interface PickerOption extends ComposerOptionItem {
  id?: string;
  label?: string;
  description?: string;
  path?: string;
  source?: string;
  nativeCommand?: string;
  targetId?: string;
  option?: NonNullable<NonNullable<DesktopSession["agentState"]>["configOptions"]>[number] & {
    configId: string;
    currentValue?: unknown;
  };
  value?: unknown;
  current?: boolean;
}

export interface ComposerInputHandle {
  trigger(kind: "@" | "/"): void;
}

export interface ConfigTarget {
  name: string;
  session?: DesktopSession;
}

export function ComposerInput({
  session,
  workbench,
  value,
  onChange,
  files,
  onFiles,
  onSubmit,
  onPanel,
  disabled,
  online,
  placeholder,
  inputActions,
  agents = [],
  group = false,
  configTargets = [],
}: {
  session: DesktopSession;
  workbench: Pick<WorkbenchLike, "features" | "phase" | "device" | "read" | "call">;
  value: string;
  onChange: (value: string) => void;
  files: string[];
  onFiles: (files: string[]) => void;
  onSubmit: () => void;
  onPanel: (panel: string) => void;
  disabled: boolean;
  online: boolean;
  placeholder: string;
  inputActions?: React.RefObject<ComposerInputHandle | null>;
  agents?: SpaceAgent[];
  group?: boolean;
  configTargets?: ConfigTarget[];
}) {
  const forceReferenceRefresh = useRef(false);
  const input = useRef<HTMLTextAreaElement | null>(null);
  const root = useRef<HTMLElement | null>(null);
  const cache = useRef(
    new Map<string, { at: number; value: ReferenceListing }>(),
  );
  const selection = useRef<{ text: string; caret: number } | null>(null);
  const dismissed = useRef(false);
  const restoringSelection = useRef(false);

  const [token, setToken] = useState<ComposerToken | null>(null);
  const [selected, setSelected] = useState(0);
  const [listing, setListing] = useState<ReferenceListing | null>(null);
  const [error, setError] = useState("");
  const [referenceLoading, setReferenceLoading] = useState(false);
  const [commandSection, setCommandSection] = useState<"commands" | "skills">(
    "commands",
  );
  const [submenu, setSubmenu] = useState<{
    kind: string;
    targetId?: string;
  } | null>(null);
  const [referenceFilter, setReferenceFilter] = useState<
    "all" | "agents" | "files"
  >("all");
  const [configBusy, setConfigBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [skillRefresh, setSkillRefresh] = useState(0);
  const [skills, setSkills] = useState<DiscoveredSkill[]>([]);
  const [skillError, setSkillError] = useState("");
  const [skillsLoading, setSkillsLoading] = useState(false);

  useEffect(() => {
    if (token?.kind !== "/" || !online || disabled) {
      return;
    }
    let stale = false;
    const controller = new AbortController();
    setSkills([]);
    setSkillError("");
    setSkillsLoading(true);
    discoverComposerSkills(workbench.read, session.id, controller.signal)
      .then((items) => {
        if (!stale) {
          setSkills(items);
        }
      })
      .catch((reason) => {
        if (!stale) {
          setSkillError(
            `技能目录读取失败，可关闭后重试：${reason instanceof Error ? reason.message : String(reason)}`,
          );
        }
      })
      .finally(() => {
        if (!stale) {
          setSkillsLoading(false);
        }
      });
    return () => {
      stale = true;
      controller.abort();
    };
  }, [token?.kind, online, disabled, session.id, workbench.read, skillRefresh]);

  const listId = useId();
  useEffect(() => {
    if (!value) {
      setToken(null);
    }
  }, [value]);

  // 在受控值提交同一周期内恢复光标位置，避免延迟动画帧覆盖后续输入
  useLayoutEffect(() => {
    const pending = selection.current;
    if (!pending) {
      return;
    }
    selection.current = null;
    if (input.current?.value !== pending.text) {
      return;
    }
    restoringSelection.current = true;
    try {
      input.current.focus();
      input.current.setSelectionRange(pending.caret, pending.caret);
    } finally {
      restoringSelection.current = false;
    }
  });

  // 预热文件名索引（只读取文件名，不读取文件内容或唤醒 Agent）
  useEffect(() => {
    if (
      token?.kind !== "@" ||
      !online ||
      disabled ||
      !workbench.features?.includes("referenceSearch")
    ) {
      return;
    }
    const controller = new AbortController();
    void workbench
      .read(
        `/sessions/${encodeURIComponent(session.id)}/references?query=`,
        controller.signal,
      )
      .catch(() => {});
    return () => controller.abort();
  }, [token?.kind, online, disabled, session.id, workbench.read]);

  const referenceQuery = token?.kind === "@" ? token.query : "";
  const { directory, browsing } = referenceRequest(session.id, referenceQuery);
  const query = referenceQuery.slice(directory.length);

  useEffect(() => {
    if (token?.kind !== "@") {
      setListing(null);
      setReferenceLoading(false);
      return;
    }
    let stale = false;
    const controller = new AbortController();
    setError("");
    setReferenceLoading(true);
    if (!online) {
      setError("连接主机后可浏览文件");
      setListing(null);
      setReferenceLoading(false);
      return;
    }
    const force = forceReferenceRefresh.current;
    forceReferenceRefresh.current = false;
    const request = referenceRequest(session.id, referenceQuery, force);
    const cacheKey = `${session.id}:${request.path}`;
    const cached = cache.current.get(cacheKey);
    if (
      request.browsing &&
      !force &&
      cached &&
      Date.now() - cached.at < 3000
    ) {
      setListing(cached.value);
      setReferenceLoading(false);
      return;
    }
    const timer = setTimeout(() => {
      workbench
        .read<{
          entries?: Array<ComposerEntry & { path: string }>;
          truncated?: boolean;
        }>(request.path, controller.signal)
        .then((result) => {
          if (stale) {
            return;
          }
          const normalized: ReferenceListing = {
            ...result,
            sessionId: session.id,
            query: referenceQuery,
            mode: request.browsing ? "directory" : "search",
            entries: (result.entries ?? [])
              .filter((item) => ["file", "directory"].includes(item.kind))
              .map((item) => ({
                ...item,
                path: item.path.replace(/^\.\//, ""),
              })),
          };
          if (request.browsing) {
            if (cache.current.size >= 30) {
              cache.current.clear();
            }
            cache.current.set(cacheKey, { at: Date.now(), value: normalized });
          }
          setListing(normalized);
        })
        .catch((reason) => {
          if (!stale) {
            setError(
              `文件${request.browsing ? "目录" : "搜索"}读取失败：${reason instanceof Error ? reason.message : String(reason)}`,
            );
          }
        })
        .finally(() => {
          if (!stale) {
            setReferenceLoading(false);
          }
        });
    }, 35);
    return () => {
      stale = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [referenceQuery, token?.kind, online, session.id, workbench.read, refresh]);

  const currentListing = listing?.sessionId === session.id ? listing : null;
  const referencesCurrent = currentListing?.query === referenceQuery;
  const referencePending =
    token?.kind === "@" &&
    online &&
    !error &&
    (referenceLoading || !referencesCurrent);

  const referenceEntries = !currentListing
    ? []
    : !referencesCurrent || currentListing.mode === "search"
      ? currentListing.entries
      : (referenceOptions(
          currentListing.entries,
          query,
          [],
          directory,
        ) as Array<ComposerEntry & { path: string }>);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) {
        setToken(null);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  const mentions: PickerOption[] = directory
    ? []
    : agents
        .filter((a) =>
          a.name.toLowerCase().includes((token?.query ?? "").toLowerCase()),
        )
        .map((a) => ({
          ...a,
          kind: "agent",
          source: group ? "会话组成员" : "项目 Agent",
          description: group ? "指定处理成员" : "提及项目成员",
        }));

  const targets = group
    ? configTargets
    : [{ name: "当前 Agent", session }];
  const target =
    targets.find((item) => item.session?.id === submenu?.targetId) ??
    (targets.length === 1 ? targets[0] : null);
  const configs = (target?.session?.agentState?.configOptions ?? []).filter(
    (option) => configCategory(option) === submenu?.kind,
  );
  const submenuKindLabels: Record<string, string> = {
    model: "模型",
    reasoning: "思考强度",
    mode: "工作模式",
  };

  const controlOptions: PickerOption[] = submenu
    ? target
      ? configs.flatMap((option): PickerOption[] => {
          const typedOption = option as NonNullable<PickerOption["option"]>;
          return option.type === "boolean"
            ? [true, false].map((val) => ({
                name: String(val),
                label: val ? "开启" : "关闭",
                kind: "config",
                option: typedOption,
                value: val,
                current: typedOption.currentValue === val,
              }))
            : configChoices(option).map((choice) => ({
                ...choice,
                label: choice.name ?? choice.value,
                description: choice.description ?? option.name,
                kind: "config",
                option: typedOption,
                current: typedOption.currentValue === choice.value,
              }));
        })
      : targets
          .filter((item): item is { name: string; session: DesktopSession } =>
            Boolean(item.session),
          )
          .map((item) => ({
            name: item.name,
            label: item.name,
            description: `配置此成员的${submenuKindLabels[submenu.kind] ?? ""}`,
            kind: "target",
            targetId: item.session.id,
          }))
    : [];

  const allCommands = commandOptions(
    group ? [] : session.agentState?.commands,
    token?.query ?? "",
    skills,
  ) as PickerOption[];
  const commands = allCommands.filter((item) => item.kind !== "skill");
  const skillOptions = allCommands.filter((item) => item.kind === "skill");

  const options: PickerOption[] =
    token?.kind === "/"
      ? submenu
        ? controlOptions
        : commandSection === "skills"
          ? skillOptions
          : commands
      : [
          ...(referenceFilter === "files" ? [] : mentions),
          ...(referenceFilter === "agents" ? [] : referenceEntries),
        ];

  useEffect(
    () => setSelected(0),
    [token?.query, listing, skills, commandSection],
  );
  useEffect(() => {
    if (token?.kind !== "/") {
      setCommandSection("commands");
    }
  }, [token?.kind]);

  useEffect(() => {
    if (referencePending) {
      return;
    }
    const list = root.current?.querySelector<HTMLElement>('[role="listbox"]');
    const item = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!list || !item) {
      return;
    }
    const box = list.getBoundingClientRect();
    const row = item.getBoundingClientRect();
    if (row.top < box.top) {
      list.scrollTop += row.top - box.top;
    } else if (row.bottom > box.bottom) {
      list.scrollTop += row.bottom - box.bottom;
    }
  }, [selected, submenu, listing, skills, referencePending]);

  const update = (text: string, caret: number) => {
    setSubmenu(null);
    dismissed.current = false;
    onChange(text);
    setToken(composerToken(text, caret));
    setError("");
  };

  const choose = async (item: PickerOption, referenceDirectory = false) => {
    if (!token || configBusy) {
      return;
    }
    if (
      token.kind === "@" &&
      item.kind !== "agent" &&
      !referenceDirectory &&
      (!referencesCurrent || referenceLoading)
    ) {
      return;
    }
    if (item.control) {
      setSubmenu({ kind: item.control });
      setSelected(0);
      setError("");
      return;
    }
    if (item.kind === "target") {
      setSubmenu((current) =>
        current ? { ...current, targetId: item.targetId } : null,
      );
      setSelected(0);
      return;
    }
    if (item.kind === "config" && target?.session && item.option) {
      if (!canConfigure(target.session, workbench)) {
        setError("请等待此成员连接完成且执行与队列结束，再修改配置");
        return;
      }
      setConfigBusy(true);
      setError("");
      try {
        await workbench.call(
          ...configureAgent(
            target.session.id,
            item.option.configId,
            item.value as never,
          ),
        );
        const next = replaceToken(value, token, "");
        onChange(next);
        setToken(null);
        setSubmenu(null);
        input.current?.focus();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        setConfigBusy(false);
      }
      return;
    }

    let insertion = "";
    if (referenceDirectory && item.path) {
      const refPath = item.path.endsWith("/") ? item.path : `${item.path}/`;
      if (files.includes(refPath)) {
        setError("此文件夹已引用");
        return;
      }
      if (files.length >= 5) {
        setError("每轮最多引用 5 个文件或文件夹");
        return;
      }
      onFiles([...files, refPath]);
    } else if (item.kind === "agent") {
      insertion = `@${item.name} `;
    } else if (item.kind === "skill" && item.nativeCommand) {
      insertion = `/${item.nativeCommand} `;
    } else if (item.kind === "skill" && item.path) {
      if (!files.includes(item.path) && files.length >= 5) {
        setError("每轮最多引用 5 个文件或文件夹，请先移除一个引用");
        return;
      }
      if (!files.includes(item.path)) {
        onFiles([...files, item.path]);
      }
      insertion = `使用技能「${item.name}」处理以下任务：`;
    } else if (token.kind === "/") {
      if (item.panel) {
        onPanel(item.panel);
      } else {
        insertion = `/${item.name} `;
      }
    } else if (item.kind === "directory") {
      insertion = `@"${item.path}/`;
    } else if (item.path) {
      if (files.includes(item.path)) {
        setError("此文件已引用");
        return;
      }
      if (files.length >= 5) {
        setError("每轮最多引用 5 个文件或文件夹");
        return;
      }
      onFiles([...files, item.path]);
    }

    const next = replaceToken(value, token, insertion);
    const caret = token.start + insertion.length;
    selection.current = { text: next, caret };
    onChange(next);
    setToken(item.kind === "directory" ? composerToken(next, caret) : null);
  };

  const trigger = (kind: "@" | "/") => {
    const caret = input.current?.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const insert = (before && !/\s$/.test(before) ? " " : "") + kind;
    const text = before + insert + value.slice(caret);
    selection.current = { text, caret: caret + insert.length };
    update(text, caret + insert.length);
  };

  useImperativeHandle(inputActions, () => ({ trigger }));

  const submenuTitles: Record<string, string> = {
    model: "选择模型",
    reasoning: "思考强度",
    mode: "工作模式",
  };

  return (
    <section className="composer-input" ref={root}>
      {Boolean(files.length) && (
        <div className="composer-references" aria-label="已引用文件">
          {files.map((filePath) => (
            <span key={filePath} title={filePath}>
              {filePath.endsWith("/") ? (
                <Folder size={14} />
              ) : (
                <File size={14} />
              )}
              <span>
                {filePath === "./"
                  ? "当前工作区"
                  : filePath.replace(/\/$/, "").split("/").at(-1)}
              </span>
              <small>{filePath.endsWith("/") ? "文件夹" : "文件"}</small>
              <button
                type="button"
                disabled={disabled}
                aria-label={`移除引用 ${filePath}`}
                onClick={() =>
                  onFiles(files.filter((file) => file !== filePath))
                }
              >
                <X size={13} />
              </button>
            </span>
          ))}
        </div>
      )}
      {token && !disabled && (
        <div
          className={`composer-picker ${referencePending ? "composer-reference-pending" : ""}`}
        >
          <div className="composer-picker-heading">
            {submenu ? (
              <button
                type="button"
                aria-label="返回指令列表"
                onClick={() => {
                  setSubmenu(null);
                  setSelected(0);
                  setError("");
                }}
              >
                <ChevronLeft size={16} />
              </button>
            ) : null}
            <span>
              {submenu
                ? submenuTitles[submenu.kind]
                : token.kind === "/"
                  ? "指令与技能"
                  : "添加上下文"}
            </span>
            <small>
              {submenu && target
                ? group
                  ? target.name
                  : "当前会话"
                : token.kind === "/"
                  ? ""
                  : "Agent · 项目文件"}
            </small>
            {token.kind === "@" && (
              <button
                type="button"
                aria-label="刷新引用目录"
                disabled={!online}
                onClick={() => {
                  cache.current.clear();
                  forceReferenceRefresh.current = true;
                  setRefresh((count) => count + 1);
                  setSkillRefresh((count) => count + 1);
                }}
              >
                <RefreshCw size={14} />
              </button>
            )}
            <button
              type="button"
              aria-label="关闭建议"
              onClick={() => setToken(null)}
            >
              <X size={14} />
            </button>
          </div>
          {token.kind === "@" && directory && (
            <button
              type="button"
              className="composer-parent"
              onClick={() => {
                const parent = directory
                  .replace(/\/$/, "")
                  .split("/")
                  .slice(0, -1)
                  .join("/");
                const insertion = parent ? `@"${parent}/` : "@";
                const next = replaceToken(value, token, insertion);
                const caret = token.start + insertion.length;
                selection.current = { text: next, caret };
                update(next, caret);
              }}
            >
              ‹ 上级目录 · {directory}
            </button>
          )}
          {token.kind === "@" &&
            browsing &&
            currentListing &&
            workbench.features?.includes("directoryReferences") && (
              <button
                type="button"
                className="composer-parent"
                disabled={referencePending}
                onClick={() => void choose({ path: directory || "./" }, true)}
              >
                <Folder size={14} /> 引用{directory || "当前工作区"}文件夹{" "}
                <small>仅目录清单</small>
              </button>
            )}
          {token.kind === "@" && !directory && (
            <div className="composer-filters" aria-label="引用类型">
              {(
                [
                  ["all", "全部"],
                  ["agents", "Agent"],
                  ["files", "文件"],
                ] as const
              ).map(([key, label]) => (
                <button
                  type="button"
                  aria-pressed={referenceFilter === key}
                  key={key}
                  onClick={() => {
                    setReferenceFilter(key);
                    setSelected(0);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {token.kind === "/" && !submenu && (
            <div className="composer-sections" aria-label="建议分区">
              {(
                [
                  ["commands", "指令", commands.length],
                  ["skills", "技能", skillOptions.length],
                ] as const
              ).map(([key, label, count]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={commandSection === key}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setCommandSection(key);
                    setSelected(0);
                    setError("");
                  }}
                >
                  {label}
                  <span>
                    {key === "skills" && skillsLoading ? "…" : count}
                  </span>
                </button>
              ))}
            </div>
          )}
          <div
            id={listId}
            role="listbox"
            aria-busy={referencePending}
            aria-label={
              token.kind === "/"
                ? commandSection === "skills" && !submenu
                  ? "技能建议"
                  : "指令建议"
                : "引用建议"
            }
          >
            {options.map((item, index) => {
              const itemKey =
                item.kind === "config"
                  ? `${item.option?.configId}:${String(item.value)}`
                  : (item.id ?? item.path ?? item.name ?? String(index));
              return (
                <React.Fragment key={itemKey}>
                  {token.kind === "/" &&
                    !submenu &&
                    commandSection === "commands" &&
                    (index === 0 ||
                      item.source !== options[index - 1]?.source) && (
                      <div className="composer-category" role="presentation">
                        {item.source}
                      </div>
                    )}
                  {token.kind === "@" &&
                    (index === 0 ||
                      (item.kind === "agent") !==
                        (options[index - 1]?.kind === "agent")) && (
                      <div className="composer-category" role="presentation">
                        {item.kind === "agent"
                          ? "Agent"
                          : item.kind === "skill"
                            ? "技能"
                            : "文件与文件夹"}
                      </div>
                    )}
                  <button
                    type="button"
                    role="option"
                    disabled={
                      configBusy ||
                      (token.kind === "@" &&
                        item.kind !== "agent" &&
                        (!referencesCurrent || referenceLoading))
                    }
                    id={`${listId}-${index}`}
                    aria-selected={index === selected}
                    onPointerMove={() => setSelected(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => void choose(item)}
                    title={item.path}
                  >
                    <ComposerOptionIcon item={item} />
                    <span>
                      <strong>{item.label ?? item.name}</strong>
                      <small>
                        {item.description ??
                          (item.kind === "directory" ? "打开目录" : item.path)}
                      </small>
                    </span>
                    {item.control ||
                    item.kind === "target" ||
                    item.kind === "directory" ? (
                      <ChevronRight
                        className="composer-option-tail"
                        size={14}
                      />
                    ) : item.current ? (
                      <Check className="composer-option-tail" size={14} />
                    ) : item.kind === "skill" ? (
                      <small className="composer-option-source">
                        {item.nativeCommand ? "Agent" : "项目"}
                      </small>
                    ) : null}
                  </button>
                </React.Fragment>
              );
            })}
          </div>
          {!options.length && (
            <p role={error ? "alert" : undefined}>
              {error ||
                (submenu
                  ? target
                    ? "此 Agent 尚未提供这项配置，连接后会显示可用选项"
                    : "此会话组没有可配置成员"
                  : token.kind === "@" && !currentListing
                    ? browsing
                      ? "正在读取目录…"
                      : "正在搜索项目文件…"
                    : token.kind === "/"
                      ? commandSection === "skills"
                        ? "未找到匹配的项目技能"
                        : "未找到指令，按 Enter 仍可发送给 Agent"
                      : "没有匹配项，可刷新目录或返回上级")}
            </p>
          )}
          {options.length > 0 && error && <p role="alert">{error}</p>}
          {token.kind === "/" &&
            !submenu &&
            commandSection === "skills" &&
            skillsLoading && <p role="status">正在读取项目技能…</p>}
          {token.kind === "/" &&
            !submenu &&
            commandSection === "skills" &&
            skillError && (
              <p role="alert">
                {skillError}{" "}
                <button
                  type="button"
                  className="composer-retry"
                  onClick={() => setSkillRefresh((count) => count + 1)}
                >
                  重试技能目录
                </button>
              </p>
            )}
          {currentListing?.truncated && token.kind === "@" && (
            <p>
              {browsing
                ? "目录较大，仅显示前 300 项。"
                : "仅显示部分匹配结果。"}
              请输入更具体的文件名或路径。
            </p>
          )}
          <footer>
            <span>
              {configBusy
                ? "正在应用配置…"
                : token.kind === "/"
                  ? commandSection === "skills"
                    ? "选择技能后，说明会作为任务上下文发送"
                    : "指令与配置由当前 Agent 提供"
                  : "文件会作为上下文随消息发送"}
            </span>
            <span>
              ↑↓ 选择 <kbd>↵</kbd> 确认
            </span>
          </footer>
        </div>
      )}
      <textarea
        ref={input}
        aria-label={group ? "发送组消息" : "发送任务"}
        aria-haspopup="listbox"
        aria-autocomplete="list"
        aria-controls={token ? listId : undefined}
        aria-expanded={Boolean(token)}
        aria-activedescendant={
          token &&
          options[selected] &&
          !(
            token.kind === "@" &&
            options[selected]?.kind !== "agent" &&
            (!referencesCurrent || referenceLoading)
          )
            ? `${listId}-${selected}`
            : undefined
        }
        disabled={disabled}
        value={value}
        placeholder={placeholder}
        onChange={(event) =>
          update(event.target.value, event.target.selectionStart)
        }
        onClick={(event) => {
          dismissed.current = false;
          setToken(composerToken(value, event.currentTarget.selectionStart));
        }}
        onFocus={(event) => {
          if (restoringSelection.current) {
            return;
          }
          dismissed.current = false;
          setToken(composerToken(value, event.currentTarget.selectionStart));
        }}
        onSelect={(event) => {
          if (token && !dismissed.current) {
            setToken(composerToken(value, event.currentTarget.selectionStart));
          }
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) {
            return;
          }
          if (token && event.key === "Escape" && submenu) {
            event.preventDefault();
            setSubmenu(null);
            setError("");
            return;
          }
          if (token && event.key === "Escape") {
            event.preventDefault();
            dismissed.current = true;
            setToken(null);
            return;
          }
          if (token && ["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            setSelected(
              (index) =>
                (index +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  Math.max(1, options.length)) %
                Math.max(1, options.length),
            );
            return;
          }
          if (token && ["Enter", "Tab"].includes(event.key) && !event.shiftKey) {
            const chosen = options[selected];
            if (chosen) {
              event.preventDefault();
              void choose(chosen);
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              if (submenu || (commandSection === "skills" && token.kind === "/")) {
                return;
              }
              if (token.kind === "/") {
                setToken(null);
                onSubmit();
              }
              return;
            }
            setToken(null);
            return;
          }
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            onSubmit();
          }
        }}
      />
    </section>
  );
}
