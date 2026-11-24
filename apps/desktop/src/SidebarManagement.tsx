import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArchiveRestore,
  Pencil,
  Pin,
  PinOff,
  Search,
  Trash2,
} from "lucide-react";
import { CompactDialog } from "./CompactDialog.tsx";
import { SessionAvatar } from "./SessionIdentity.tsx";
import type {
  DesktopSession,
  ProjectItem,
  SpaceAgent,
  SpaceThread,
  SpacesController,
  WorkbenchLike,
} from "./types.ts";

export interface SidebarContextTarget {
  kind: "project" | "session";
  item?: DesktopSession | ProjectItem | { id: string; title?: string; name?: string; status?: string };
  identity?: SpaceAgent | null;
  thread?: SpaceThread | null;
}

interface MenuState extends SidebarContextTarget {
  item: NonNullable<SidebarContextTarget["item"]>;
  x: number;
  y: number;
}

export function useSidebarManagement({
  workbench,
  spaces,
  onError,
}: {
  workbench: Pick<WorkbenchLike, "call">;
  spaces: Pick<SpacesController, "command">;
  onError?: (message: string) => void;
}) {
  const [pins, setPins] = useState<Record<string, boolean>>(() => {
    try {
      return (
        (JSON.parse(
          localStorage.getItem("vibeone-sidebar-pins") ?? "{}",
        ) as Record<string, boolean>) ?? {}
      );
    } catch {
      return {};
    }
  });
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [rename, setRename] = useState<MenuState | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef<HTMLDivElement | null>(null);
  const prior = useRef<HTMLElement | null>(null);

  const pinned = (kind: string, id: string) => pins[`${kind}:${id}`] === true;
  const sort = <T extends { id: string; conversation?: string }>(
    items: T[],
    kind = "session",
  ): T[] =>
    [...items].sort(
      (a, b) =>
        Number(pinned(kind, b.conversation ?? b.id)) -
        Number(pinned(kind, a.conversation ?? a.id)),
    );

  const close = () => {
    setMenu(null);
    prior.current?.focus?.();
  };

  useEffect(() => {
    if (!menu) {
      return;
    }
    ref.current?.querySelector<HTMLElement>("button")?.focus();
    const outside = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setMenu(null);
      }
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
      if (["ArrowDown", "ArrowUp"].includes(e.key)) {
        const buttons = [
          ...(ref.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled)",
          ) ?? []),
        ];
        const i = buttons.indexOf(document.activeElement as HTMLElement);
        e.preventDefault();
        buttons[
          (i + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
            buttons.length
        ]?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
    };
  }, [menu]);

  const context = (
    e: React.MouseEvent<HTMLElement>,
    target: SidebarContextTarget,
  ) => {
    if (!target.item) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    prior.current =
      e.currentTarget.querySelector<HTMLElement>("button") ?? e.currentTarget;
    setMenu({
      ...target,
      item: target.item,
      x: Math.max(8, Math.min(innerWidth - 206, e.clientX)),
      y: Math.max(8, Math.min(innerHeight - 148, e.clientY)),
    });
  };

  const run = async (action: () => Promise<unknown>) => {
    if (busy) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await action();
      setRename(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      onError?.(msg);
    } finally {
      setBusy(false);
    }
  };

  const protectedIdentity = Boolean(
    menu?.identity?.steward || menu?.thread?.coordination,
  );
  const itemStatus =
    menu?.item && "status" in menu.item ? (menu.item.status ?? "") : "";
  const active =
    ["starting", "running", "requires_action", "cancelling"].includes(
      itemStatus,
    ) || menu?.thread?.state === "running";

  const menuNode =
    menu &&
    createPortal(
      <div
        ref={ref}
        className="sidebar-context-menu"
        role="menu"
        aria-label={menu.kind === "project" ? "项目操作" : "Agent操作"}
        style={{ left: menu.x, top: menu.y }}
      >
        <button
          role="menuitem"
          onClick={() => {
            const key = `${menu.kind}:${menu.item.id}`;
            const next = { ...pins, [key]: !pinned(menu.kind, menu.item.id) };
            setPins(next);
            try {
              localStorage.setItem(
                "vibeone-sidebar-pins",
                JSON.stringify(next),
              );
            } catch {
              // 忽略本地存储异常
            }
            close();
          }}
        >
          {pinned(menu.kind, menu.item.id) ? (
            <PinOff size={15} />
          ) : (
            <Pin size={15} />
          )}{" "}
          {pinned(menu.kind, menu.item.id) ? "取消置顶" : "置顶"}
        </button>
        {menu.kind === "session" && (
          <>
            <button
              role="menuitem"
              disabled={protectedIdentity}
              onClick={() => {
                setRename(menu);
                const fallbackTitle =
                  "title" in menu.item ? (menu.item.title ?? "") : "";
                setName(
                  menu.identity?.name ?? menu.thread?.name ?? fallbackTitle,
                );
                setError("");
                close();
              }}
            >
              <Pencil size={15} />
              重命名
            </button>
            <button
              role="menuitem"
              className="danger"
              disabled={busy || active || protectedIdentity}
              onClick={() => {
                const target = menu.item;
                close();
                void run(() =>
                  workbench.call(`/sessions/${target.id}/metadata`, {
                    archived: true,
                    key: crypto.randomUUID(),
                  }),
                );
              }}
            >
              <Trash2 size={15} />
              删除
            </button>
          </>
        )}
      </div>,
      document.querySelector(".desktop-app") ?? document.body,
    );

  const overlay = (
    <>
      {menuNode}
      {rename && (
        <CompactDialog
          title="重命名"
          busy={busy}
          close={() => setRename(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                if (rename.identity) {
                  await spaces.command({
                    action: "agent-update",
                    projectId: rename.identity.projectId,
                    id: rename.identity.id,
                    name: name.trim(),
                  });
                } else if (rename.thread) {
                  await spaces.command({
                    action: "thread-update",
                    projectId: rename.thread.projectId,
                    id: rename.thread.id,
                    name: name.trim(),
                  });
                } else {
                  await workbench.call(`/sessions/${rename.item.id}/metadata`, {
                    title: name.trim(),
                    key: crypto.randomUUID(),
                  });
                }
              });
            }}
          >
            <fieldset disabled={busy}>
              <label className="space-field">
                名称
                <input
                  aria-label="重命名名称"
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={100}
                  required
                />
              </label>
            </fieldset>
            {error && (
              <p className="space-editor-error" role="alert">
                {error}
              </p>
            )}
            <footer>
              <button
                type="button"
                disabled={busy}
                onClick={() => setRename(null)}
              >
                取消
              </button>
              <button
                className="space-primary"
                disabled={busy || !name.trim()}
              >
                保存
              </button>
            </footer>
          </form>
        </CompactDialog>
      )}
    </>
  );

  return { context, pinned, sort, overlay };
}

export function ArchivedConversations({
  workbench,
  spaces,
  onOpen,
}: {
  workbench: WorkbenchLike;
  spaces: SpacesController;
  onOpen: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const items = workbench.sessions.filter(
    (s) =>
      s.archived &&
      !spaces.hidden.has(s.id) &&
      (s.title ?? "").toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <>
      <p className="settings-description">
        已归档及从侧栏删除的对话保留在这里，可恢复后继续。项目文件不受影响。
      </p>
      <label className="archive-search">
        <Search size={15} />
        <input
          aria-label="搜索归档"
          placeholder="搜索已归档对话"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="archive-list">
        {items.map((s) => {
          const identity = spaces.agentFor(s.id);
          return (
            <div className="archive-row" key={s.id}>
              <SessionAvatar
                color={identity?.color}
                shape={identity?.shape}
              />
              <span>
                <strong>
                  {identity?.name ?? spaces.threadFor(s.id)?.name ?? s.title}
                </strong>
                <small title={s.workspace}>{s.workspace}</small>
              </span>
              <button
                disabled={Boolean(busy)}
                onClick={() => {
                  setBusy(s.id);
                  setError("");
                  void workbench
                    .call(`/sessions/${s.id}/metadata`, {
                      archived: false,
                      key: crypto.randomUUID(),
                    })
                    .catch((e) =>
                      setError(e instanceof Error ? e.message : String(e)),
                    )
                    .finally(() => setBusy(null));
                }}
              >
                <ArchiveRestore size={14} />
                {busy === s.id ? "正在恢复…" : "恢复"}
              </button>
              <button onClick={() => onOpen(s.id)}>查看</button>
            </div>
          );
        })}
        {!items.length && (
          <p className="archive-empty">
            {query ? "没有匹配的归档对话" : "暂无归档对话"}
          </p>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
