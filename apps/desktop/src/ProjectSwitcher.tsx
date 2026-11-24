import React, { useEffect, useId, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  FolderOpen,
  GitBranch,
  Home,
  LoaderCircle,
  Search,
} from "lucide-react";
import type { ProjectDetailsResult } from "../electron/ipc.ts";
import { invoke } from "./native.ts";
import type { ProjectItem } from "./types.ts";

const badgeColors = [
  "#9B7410",
  "#43745B",
  "#5473A6",
  "#8D5AA6",
  "#AB6550",
  "#387D87",
];

function ProjectBadge({ project }: { project: ProjectItem }) {
  const name = project.name ?? "";
  const words = name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[\s_\-./]+/)
    .filter(Boolean);
  const firstWord = words[0] ? Array.from(words[0])[0] ?? "" : "";
  const secondWord = words[1] ? Array.from(words[1])[0] ?? "" : "";
  const initials = (
    words.length > 1
      ? firstWord + secondWord
      : Array.from(name).slice(0, 2).join("")
  ).toUpperCase();

  let hash = 2166136261;
  for (const char of project.id) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  }
  return (
    <span
      className="project-badge"
      style={{ background: badgeColors[hash % badgeColors.length] }}
      aria-hidden="true"
    >
      {initials || "P"}
    </span>
  );
}

export function SidebarHome({
  active = false,
  onClick,
}: {
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`sidebar-home ${active ? "selected" : ""}`}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
    >
      <Home size={15} />
      <span>首页</span>
    </button>
  );
}

export function ProjectSwitcher({
  project,
  projects = [],
  onSelect,
  busy = false,
}: {
  project?: ProjectItem;
  projects?: ProjectItem[];
  onSelect: (project: ProjectItem) => void | Promise<unknown>;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>(() => {
    try {
      const ids = JSON.parse(
        localStorage.getItem("vibeone-recent-projects-v1") ?? "[]",
      ) as unknown[];
      return Array.isArray(ids)
        ? ids.filter((id): id is string => typeof id === "string").slice(0, 8)
        : [];
    } catch {
      return [];
    }
  });
  const [details, setDetails] = useState<ProjectDetailsResult>({
    projects: [],
    homeDirectory: "",
  });
  const ids = projects
    .map((p) => p.id)
    .slice(0, 64)
    .join("\u0000");

  useEffect(() => {
    if (!window.vibeoneDesktop) {
      return;
    }
    let stale = false;
    const refresh = () => {
      if (document.hidden) {
        return;
      }
      invoke("project_details", { ids: ids.split("\u0000").filter(Boolean) })
        .then((value) => {
          if (!stale && Array.isArray(value?.projects)) {
            setDetails(value);
          }
        })
        .catch(() => {});
    };
    refresh();
    const timer = setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    return () => {
      stale = true;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [ids, open]);

  const compactPath = (value: string) =>
    details.homeDirectory &&
    (value === details.homeDirectory ||
      value.startsWith(`${details.homeDirectory}/`))
      ? `~${value.slice(details.homeDirectory.length)}`
      : value;

  const currentBranch = details.projects.find(
    (p) => p.id === project?.id,
  )?.branch;
  const root = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const search = useRef<HTMLInputElement | null>(null);
  const listId = useId();

  useEffect(() => {
    if (!project?.id) {
      return;
    }
    setRecent((previous) => {
      const next = [
        project.id,
        ...previous.filter((id) => id !== project.id),
      ].slice(0, 8);
      try {
        localStorage.setItem(
          "vibeone-recent-projects-v1",
          JSON.stringify(next),
        );
      } catch {
        // 忽略本地存储异常
      }
      return next;
    });
  }, [project?.id]);

  const close = () => {
    setOpen(false);
    setQuery("");
    trigger.current?.focus();
  };

  useEffect(() => {
    if (!open) {
      return;
    }
    search.current?.focus();
    const outside = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const filtered = projects.filter((p) =>
    `${p.name} ${(p.paths ?? []).join(" ")}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const recentProjects = recent
    .map((id) => filtered.find((p) => p.id === id))
    .filter((p): p is ProjectItem => Boolean(p && p.id !== project?.id));

  const sections: Array<[string, ProjectItem[]]> = query.trim()
    ? [["搜索结果", filtered]]
    : [
        ["当前项目", filtered.filter((p) => p.id === project?.id)],
        ["最近项目", recentProjects],
        [
          "所有项目",
          filtered.filter(
            (p) => p.id !== project?.id && !recent.includes(p.id),
          ),
        ],
      ];

  return (
    <div
      className="project-switcher"
      ref={root}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
        if (
          ["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key) &&
          open &&
          (e.key.startsWith("Arrow") ||
            document.activeElement !== search.current)
        ) {
          const buttons = [
            ...(root.current?.querySelectorAll<HTMLElement>(
              "[role=option]:not(:disabled)",
            ) ?? []),
          ];
          if (!buttons.length) {
            return;
          }
          e.preventDefault();
          const index = buttons.indexOf(document.activeElement as HTMLElement);
          const next =
            e.key === "Home"
              ? 0
              : e.key === "End"
                ? buttons.length - 1
                : index < 0
                  ? e.key === "ArrowUp"
                    ? buttons.length - 1
                    : 0
                  : (index + (e.key === "ArrowUp" ? -1 : 1) + buttons.length) %
                    buttons.length;
          buttons[next]?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="project-switcher-trigger"
        aria-label="切换项目"
        title={project?.paths?.join("\n")}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-haspopup="listbox"
        disabled={busy}
        onClick={() => {
          setOpen(!open);
          setQuery("");
        }}
        onKeyDown={(e) => {
          if (!open && ["ArrowDown", "ArrowUp"].includes(e.key)) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {busy ? (
          <LoaderCircle size={14} className="desktop-spin" />
        ) : project ? (
          <ProjectBadge project={project} />
        ) : (
          <FolderOpen size={14} />
        )}
        <strong>{project?.name ?? "选择项目"}</strong>
        {currentBranch && (
          <span className="project-trigger-branch" title={currentBranch}>
            <GitBranch size={12} />
            <span>{currentBranch}</span>
          </span>
        )}
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="project-switcher-popup">
          <label className="project-switcher-search">
            <Search size={13} />
            <input
              ref={search}
              aria-label="搜索项目"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索项目名称或路径…"
            />
          </label>
          <div
            id={listId}
            role="listbox"
            aria-label="项目列表"
            className="project-switcher-list"
          >
            {sections.map(
              ([label, items]) =>
                Boolean(items.length) && (
                  <div role="group" aria-label={label} key={label}>
                    <div className="project-switcher-section">{label}</div>
                    {items.map((p) => {
                      const branch = details.projects.find(
                        (d) => d.id === p.id,
                      )?.branch;
                      return (
                        <button
                          type="button"
                          role="option"
                          aria-selected={p.id === project?.id}
                          key={p.id}
                          title={(p.paths ?? []).join("\n")}
                          disabled={!p.paths?.length}
                          onClick={() => {
                            close();
                            void onSelect(p);
                          }}
                        >
                          <ProjectBadge project={p} />
                          <span className="project-switcher-copy">
                            <strong>{p.name}</strong>
                            <small>
                              {p.paths?.[0]
                                ? compactPath(p.paths[0])
                                : "尚未引入工作目录"}
                              {(p.paths?.length ?? 0) > 1
                                ? ` · ${p.paths.length} 个目录`
                                : ""}
                            </small>
                            {branch && (
                              <small className="project-branch" title={branch}>
                                <GitBranch size={12} />
                                <span>{branch}</span>
                              </small>
                            )}
                          </span>
                          {p.id === project?.id && <Check size={14} />}
                        </button>
                      );
                    })}
                  </div>
                ),
            )}
            {!filtered.length && (
              <p className="project-switcher-empty">
                {projects.length
                  ? "没有匹配的项目"
                  : "先在首页设置中创建项目"}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
