import React, { useCallback, useEffect, useRef, useState } from "react";
import { chooseWorkspace } from "./api.ts";
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
      <section className="settings-group">
        <h2>项目</h2>
        <p className="group-description">
          一个项目可引入多个工作目录，并创建多个会话。每个会话选择一个目录作为执行位置。
        </p>
        <div className="settings-rows">
          <div className="settings-row">
            <div>
              <strong>新建项目</strong>
              <small>设置名称并添加源文件夹。</small>
            </div>
            <button
              className="settings-action"
              onClick={() => setCreating(true)}
            >
              创建项目
            </button>
          </div>
        </div>
      </section>
      <section className="settings-group">
        <h2>引入工作目录</h2>
        <div className="settings-rows">
          {project ? (
            <>
              <div className="settings-row">
                <div>
                  <strong>项目</strong>
                </div>
                <div className="settings-control">
                  <select
                    aria-label="管理项目"
                    value={project.id}
                    onChange={(e) => setSelected(e.target.value)}
                  >
                    {projects.items.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {project.paths.map((p) => (
                <div className="settings-row" key={p}>
                  <code title={p}>{p}</code>
                </div>
              ))}
              <form
                className="settings-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    await projects.save({ id: project.id, addPath: path });
                    setPath("");
                  });
                }}
              >
                <label>
                  工作目录
                  <input
                    aria-label="引入工作目录"
                    value={path}
                    onChange={(e) => setPath(e.target.value)}
                    placeholder="输入目录的绝对路径"
                    list="project-directory-options"
                  />
                </label>
                <datalist id="project-directory-options">
                  {(workbench.workspaces ?? []).map((w) => (
                    <option value={w.path} key={w.id}>
                      {w.name}
                    </option>
                  ))}
                </datalist>
                <button
                  type="button"
                  className="settings-action"
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
                  选择目录
                </button>
                <button
                  className="settings-action"
                  disabled={busy || !path.trim()}
                >
                  引入目录
                </button>
              </form>
            </>
          ) : (
            <p>先创建一个项目，再引入工作目录。</p>
          )}
        </div>
      </section>
      {(error || projects.error) && (
        <p role="alert">{error || projects.error}</p>
      )}
    </>
  );
}
