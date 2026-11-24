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
import { Alert } from "./components/ui/alert.tsx";
import { Button } from "./components/ui/button.tsx";
import { Card } from "./components/ui/card.tsx";
import { Input } from "./components/ui/input.tsx";
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
    <div className="space-y-4">
      <p className="m-0 text-[13px] leading-relaxed text-[var(--ink-secondary)]">
        已归档及从侧栏删除的对话保留在这里，可恢复后继续。项目文件不受影响。
      </p>
      <div className="relative">
        <Search
          size={15}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]"
        />
        <Input
          aria-label="搜索归档"
          placeholder="搜索已归档对话"
          value={query}
          className="pl-9"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <Card className="divide-y divide-[var(--line)] overflow-hidden">
        {items.map((s) => {
          const identity = spaces.agentFor(s.id);
          return (
            <div
              className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center"
              key={s.id}
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <SessionAvatar
                  color={identity?.color}
                  shape={identity?.shape}
                />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="truncate text-[13.5px] font-medium text-[var(--fg)]">
                    {identity?.name ?? spaces.threadFor(s.id)?.name ?? s.title}
                  </div>
                  <div
                    title={s.workspace}
                    className="truncate font-mono text-[11.5px] text-[var(--muted)]"
                  >
                    {s.workspace}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
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
                  <ArchiveRestore size={13} />
                  {busy === s.id ? "正在恢复…" : "恢复"}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onOpen(s.id)}>
                  查看
                </Button>
              </div>
            </div>
          );
        })}
        {!items.length && (
          <div className="py-12 text-center text-[13px] text-[var(--muted)]">
            {query ? "没有匹配的归档对话" : "暂无归档对话"}
          </div>
        )}
      </Card>
      {error && (
        <Alert variant="destructive" role="alert">
          {error}
        </Alert>
      )}
    </div>
  );
}
