import React, { useEffect, useRef, useState } from "react";
import {
  File,
  Folder,
  GitBranch,
  Globe,
  Maximize2,
  Minimize2,
  Plus,
  Terminal,
  X,
  type LucideIcon,
} from "lucide-react";
import { ContextStart } from "./ContextStart.tsx";
import {
  WorkspaceTool,
  useWorkspaceExtensions,
} from "./workspace-extensions.tsx";
import type { TurnChangesSnapshot } from "./ChatTimeline.tsx";

const tools = [
  ["changes", "变更", GitBranch],
  ["files", "文件", Folder],
  ["terminal", "终端", Terminal],
  ["browser", "网页", Globe],
] as const;

const extraLabels: Record<string, string> = {
  runs: "执行记录",
  agent: "Agent 设置",
  artifacts: "产物",
};

const iconMap: Record<string, LucideIcon> = {
  folder: Folder,
  changes: GitBranch,
  terminal: Terminal,
  browser: Globe,
};

const label = (kind: string): string =>
  tools.find((item) => item[0] === kind)?.[1] ??
  extraLabels[kind] ??
  "新标签页";

export interface ContextTabItem {
  id: string;
  kind: string;
  title: string;
  runId?: string;
  changeSnapshot?: TurnChangesSnapshot;
  file?: { path: string; key: string };
  url?: string;
}

const make = (
  kind: string,
  extra: Partial<ContextTabItem> = {},
): ContextTabItem => ({
  id: crypto.randomUUID(),
  kind,
  title: label(kind),
  ...extra,
});

class ToolBoundary extends React.Component<
  { children: React.ReactNode },
  { error: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: false };
  }

  static getDerivedStateFromError() {
    return { error: true };
  }

  render() {
    return this.state.error ? (
      <section className="context-tool-failure" role="alert">
        <h2>工具暂时无法显示</h2>
        <p>当前对话仍已保留，可以重试此标签页。</p>
        <button onClick={() => this.setState({ error: false })}>
          重新加载工具
        </button>
      </section>
    ) : (
      this.props.children
    );
  }
}

export function ContextTabs({
  kind,
  onKind,
  fileRequest,
  browserRequest,
  expanded,
  onExpand,
  renderTool,
  runChangesRequest,
  overview,
}: {
  kind: string;
  onKind: (kind: string) => void;
  fileRequest?: { path: string; key: string } | null;
  browserRequest?: { url: string; key: string } | null;
  expanded: boolean;
  onExpand: () => void;
  renderTool: (
    item: ContextTabItem,
    onTitle: (title: string) => void,
  ) => React.ReactNode;
  runChangesRequest?: {
    runId: string;
    snapshot: TurnChangesSnapshot;
    key: string;
  } | null;
  overview?: React.ReactNode;
}) {
  const extensions = useWorkspaceExtensions();
  const [state, setState] = useState<{
    items: ContextTabItem[];
    active: string | null;
  }>({ items: [], active: null });
  const seenFile = useRef<string | null>(null);
  const seenUrl = useRef<string | null>(null);
  const seenChanges = useRef<string | null>(null);

  useEffect(() => {
    if (!runChangesRequest || seenChanges.current === runChangesRequest.key) {
      return;
    }
    seenChanges.current = runChangesRequest.key;
    setState((s) => {
      const found = s.items.find((t) => t.runId === runChangesRequest.runId);
      const next =
        found ??
        make("run-changes", {
          runId: runChangesRequest.runId,
          changeSnapshot: runChangesRequest.snapshot,
          title: "本轮变更",
        });
      return {
        items: found ? s.items : [...s.items, next],
        active: next.id,
      };
    });
  }, [runChangesRequest]);

  useEffect(() => {
    if (
      kind === "run-changes" ||
      kind === "chat" ||
      (kind === "files" && fileRequest && seenFile.current !== fileRequest.key) ||
      (kind === "browser" &&
        browserRequest &&
        seenUrl.current !== browserRequest.key)
    ) {
      return;
    }
    setState((s) => {
      if (s.items.find((t) => t.id === s.active)?.kind === kind) {
        return s;
      }
      const found = s.items.find((t) => t.kind === kind);
      const next = found ?? make(kind);
      return {
        items: found ? s.items : [...s.items, next],
        active: next.id,
      };
    });
  }, [kind]);

  useEffect(() => {
    if (!fileRequest || seenFile.current === fileRequest.key) {
      return;
    }
    seenFile.current = fileRequest.key;
    setState((s) => {
      const found = s.items.find(
        (t) => t.kind === "files" && t.file?.path === fileRequest.path,
      );
      const next =
        found ??
        make("files", {
          file: fileRequest,
          title: fileRequest.path.split(/[\\/]/).at(-1) ?? fileRequest.path,
        });
      return {
        items: found ? s.items : [...s.items, next],
        active: next.id,
      };
    });
  }, [fileRequest]);

  useEffect(() => {
    if (!browserRequest || seenUrl.current === browserRequest.key) {
      return;
    }
    seenUrl.current = browserRequest.key;
    setState((s) => {
      const found = s.items.find(
        (t) => t.kind === "browser" && t.url === browserRequest.url,
      );
      const next =
        found ??
        make("browser", {
          url: browserRequest.url,
          title: new URL(browserRequest.url).hostname,
        });
      return {
        items: found ? s.items : [...s.items, next],
        active: next.id,
      };
    });
  }, [browserRequest]);

  const select = (item: ContextTabItem) => {
    setState((s) => ({ ...s, active: item.id }));
    onKind(item.kind);
  };

  const add = () => {
    const next = make("home");
    setState((s) => ({ items: [...s.items, next], active: next.id }));
    onKind("home");
  };

  const close = (item: ContextTabItem) => {
    const items = state.items.filter((t) => t.id !== item.id);
    const active =
      state.active === item.id
        ? ((items[Math.max(0, state.items.indexOf(item) - 1)] ?? items.at(-1))
            ?.id ?? null)
        : state.active;
    setState({ items, active });
    if (state.active === item.id) {
      onKind(items.find((t) => t.id === active)?.kind ?? "chat");
    }
  };

  const choose = (item: ContextTabItem, nextKind: string) => {
    setState((s) => ({
      ...s,
      items: s.items.map((t) =>
        t.id === item.id
          ? {
              ...t,
              kind: nextKind,
              title:
                extensions.tools.find((tool) => tool.id === nextKind)?.title ??
                label(nextKind),
            }
          : t,
      ),
    }));
    onKind(nextKind);
  };

  const title = (id: string, value: string) =>
    setState((s) =>
      s.items.some((t) => t.id === id && t.title !== value)
        ? {
            ...s,
            items: s.items.map((t) =>
              t.id === id ? { ...t, title: value } : t,
            ),
          }
        : s,
    );

  const activeItem = state.items.find((t) => t.id === state.active);
  // 工作区变更概览仅在变更或文件类标签页中显示，避免遮挡网页、终端或新建页
  const showOverview = Boolean(
    activeItem && ["changes", "run-changes", "files"].includes(activeItem.kind),
  );

  return (
    <>
      <header className="panel-tabs desktop-right-panel-header">
        <div
          className="context-tabstrip"
          role="tablist"
          aria-label="工作区标签页"
        >
          {state.items.map((item) => {
            const extIcon = extensions.tools.find(
              (tool) => tool.id === item.kind,
            )?.icon;
            const Icon =
              tools.find((t) => t[0] === item.kind)?.[2] ??
              (extIcon ? iconMap[extIcon] : undefined) ??
              (item.kind === "home" ? Globe : File);
            return (
              <div
                className={`context-tab ${state.active === item.id ? "active" : ""}`}
                key={item.id}
              >
                <button
                  role="tab"
                  aria-selected={state.active === item.id}
                  aria-controls={`pane-${item.id}`}
                  id={`tab-${item.id}`}
                  onClick={() => select(item)}
                  title={item.title}
                >
                  <Icon size={14} />
                  <span>{item.title}</span>
                </button>
                <button
                  aria-label={`关闭 ${item.title}`}
                  onClick={() => close(item)}
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>
        <button
          className="icon-button"
          aria-label="新增标签页"
          onClick={add}
        >
          <Plus size={15} />
        </button>
        <div className="panel-controls">
          <button
            className="icon-button"
            aria-label={expanded ? "恢复面板宽度" : "扩大预览"}
            onClick={onExpand}
          >
            {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
          <button
            className="icon-button"
            aria-label="收起右侧面板"
            onClick={() => onKind("chat")}
          >
            <X size={15} />
          </button>
        </div>
      </header>
      {showOverview ? overview : null}
      {state.items.map((item) => (
        <div
          className="context-tabpane"
          role="tabpanel"
          id={`pane-${item.id}`}
          aria-labelledby={`tab-${item.id}`}
          hidden={state.active !== item.id}
          key={item.id}
        >
          <ToolBoundary key={item.kind}>
            {item.kind === "home" ? (
              !extensions.tools.some((tool) => tool.id === "browser") ? (
                <ContextStart onChoose={(value) => choose(item, value)} />
              ) : (
                <WorkspaceTool
                  kind="browser"
                  onNavigate={(url) => {
                    setState((s) => ({
                      ...s,
                      items: s.items.map((t) =>
                        t.id === item.id
                          ? {
                              ...t,
                              kind: "browser",
                              url,
                              title: new URL(url).hostname,
                            }
                          : t,
                      ),
                    }));
                    onKind("browser");
                  }}
                  emptyState={
                    <ContextStart onChoose={(value) => choose(item, value)} />
                  }
                />
              )
            ) : item.kind === "browser" ? (
              <WorkspaceTool
                kind="browser"
                initialUrl={item.url}
                visible={kind !== "chat" && state.active === item.id}
              />
            ) : (
              renderTool(item, (value) => title(item.id, value))
            )}
          </ToolBoundary>
        </div>
      ))}
    </>
  );
}
