import React, { useCallback, useEffect, useRef, useState } from "react";
import { Folder, FolderOpen, Plus } from "lucide-react";
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
import { CreateProjectDialog } from "./CreateProjectDialog.tsx";
import type {
  DesktopSession,
  ProjectItem,
  ProjectsController,
  WorkbenchLike,
} from "./types.ts";

export function useProjects(
  workbench: Pick<WorkbenchLike, "phase" | "call">,
): ProjectsController {
  const [items, setItems] = useState<ProjectItem[]>([]);
  const [error, setError] = useState("");
  const generation = useRef(0);

  const reload = useCallback(async () => {
    const epoch = ++generation.current;
    try {
      const value = await workbench.call<{ projects: ProjectItem[] }>(
        "/projects",
      );
      if (epoch === generation.current) {
        setItems(value.projects);
        setError("");
      }
    } catch (err) {
      if (epoch === generation.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  }, [workbench.call]);

  useEffect(() => {
    if (workbench.phase !== "online") {
      return;
    }
    void reload();
    const timer = setInterval(() => {
      if (!document.hidden) {
        void reload();
      }
    }, 30000);
    return () => {
      generation.current++;
      clearInterval(timer);
    };
  }, [workbench.phase, reload]);

  const save = async (body: {
    id?: string;
    name?: string;
    addPath?: string;
  }) => {
    const value = await workbench.call<ProjectItem>("/projects", body);
    await reload();
    return value;
  };

  return { items, error, reload, save };
}

export function projectGroups(
  sessions: DesktopSession[] = [],
  projects: ProjectItem[] = [],
  workspaces: Array<{ id: string; name: string; path: string }> = [],
) {
  if (!projects.length) {
    return workspaces
      .map((w) => ({
        id: `workspace:${w.id}`,
        name: w.name,
        paths: [w.path],
        implicit: true,
      }))
      .map((p) => ({
        ...p,
        sessions: sessions.filter((s) => p.paths.includes(s.workspace)),
      }))
      .filter((p) => p.sessions.length > 0);
  }
  return projects
    .map((p) => ({
      ...p,
      sessions: sessions.filter((s) => p.paths.includes(s.workspace)),
    }))
    .filter((p) => !p.implicit || p.sessions.length > 0);
}

export function ProjectSettings({
  projects,
  workbench,
}: {
  projects: ProjectsController;
  workbench: WorkbenchLike;
}) {
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState("");
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const project =
    projects.items.find((p) => p.id === selected) ?? projects.items[0];

  const run = async (operation: () => Promise<void>) => {
    if (busy) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {creating && (
        <CreateProjectDialog
          projects={projects}
          onClose={() => setCreating(false)}
          onCreated={(value) => setSelected(value.id)}
        />
      )}

      <SettingSection
        title="项目"
        description="一个项目可引入多个工作目录，并创建多个会话。每个会话选择一个目录作为执行位置。"
      >
        <SettingItem
          title="新建项目"
          description="设置名称并添加源文件夹。"
        >
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus size={14} />
            创建项目
          </Button>
        </SettingItem>
      </SettingSection>

      <SettingSection title="引入工作目录">
        {project ? (
          <>
            <SettingItem title="项目" description="选择要绑定目录的目标项目。">
              <Select
                aria-label="管理项目"
                value={project.id}
                onChange={(e) => setSelected(e.target.value)}
                wrapperClassName="w-full sm:w-56"
              >
                {projects.items.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </SettingItem>

            {project.paths.map((p) => (
              <div
                className="flex items-center gap-3 px-5 py-3.5 text-[12.5px]"
                key={p}
              >
                <Folder
                  size={15}
                  className="shrink-0 text-[var(--ink-secondary)]"
                />
                <code
                  title={p}
                  className="min-w-0 flex-1 font-mono text-[12px] text-[var(--ink-secondary)] [overflow-wrap:anywhere]"
                >
                  {p}
                </code>
              </div>
            ))}

            <SettingBlock>
              <form
                className="flex flex-col gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    await projects.save({ id: project.id, addPath: path });
                    setPath("");
                  });
                }}
              >
                <label className="space-y-1.5 text-[12.5px] font-medium text-[var(--fg)]">
                  <span>工作目录</span>
                  <Input
                    aria-label="引入工作目录"
                    value={path}
                    onChange={(e) => setPath(e.target.value)}
                    placeholder="输入目录的绝对路径"
                    list="project-directory-options"
                    className="font-mono text-[12px]"
                  />
                </label>
                <datalist id="project-directory-options">
                  {(workbench.workspaces ?? []).map((w) => (
                    <option value={w.path} key={w.id}>
                      {w.name}
                    </option>
                  ))}
                </datalist>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const nextPath = await chooseWorkspace();
                        if (nextPath) {
                          setPath(nextPath);
                        }
                      })
                    }
                  >
                    <FolderOpen size={13} />
                    选择目录
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={busy || !path.trim()}
                  >
                    引入目录
                  </Button>
                </div>
              </form>
            </SettingBlock>
          </>
        ) : (
          <SettingBlock className="text-[12.5px] text-[var(--muted)]">
            先创建一个项目，再引入工作目录。
          </SettingBlock>
        )}
      </SettingSection>

      {(error || projects.error) && (
        <Alert variant="destructive" role="alert" className="mt-4">
          {error || projects.error}
        </Alert>
      )}
    </>
  );
}
