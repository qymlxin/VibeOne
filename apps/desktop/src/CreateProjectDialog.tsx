import React, { useRef, useState } from "react";
import { FolderOpen, FolderPlus, LoaderCircle, Plus, X } from "lucide-react";
import { chooseWorkspace } from "./api.ts";
import { CompactDialog } from "./CompactDialog.tsx";
import type { ProjectItem, ProjectsController } from "./types.ts";

export function CreateProjectDialog({
  projects,
  onClose,
  onCreated,
}: {
  projects: ProjectsController;
  onClose: () => void;
  onCreated?: (project: ProjectItem) => void;
}) {
  const [name, setName] = useState("");
  const [paths, setPaths] = useState<string[]>([]);
  const [path, setPath] = useState("");
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState("");
  const id = useRef(crypto.randomUUID());
  const saved = useRef(new Set<string>());
  const gate = useRef(false);

  const add = (value: string) => {
    const p = value?.trim();
    if (!p) {
      return;
    }
    setPaths((old) => (old.includes(p) ? old : [...old, p]));
    setPath("");
  };

  const pick = async () => {
    setPicking(true);
    setError("");
    try {
      const value = await chooseWorkspace();
      if (value) {
        add(value);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setManual(true);
    } finally {
      setPicking(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (gate.current) {
      return;
    }
    gate.current = true;
    setBusy(true);
    setError("");
    try {
      let result = await projects.save({ id: id.current, name: name.trim() });
      for (const p of paths) {
        if (saved.current.has(p)) {
          continue;
        }
        result = await projects.save({ id: id.current, addPath: p });
        saved.current.add(p);
      }
      onCreated?.(result);
      onClose();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(
        `${message}${saved.current.size ? "；已添加的目录已保留，可重试继续。" : ""}`,
      );
    } finally {
      gate.current = false;
      setBusy(false);
    }
  };

  return (
    <CompactDialog
      title="创建项目"
      close={onClose}
      busy={busy || picking}
      className="create-project-dialog"
    >
      <form onSubmit={submit}>
        <fieldset disabled={busy || picking}>
          <label className="project-name-input">
            <FolderOpen size={17} />
            <input
              autoFocus
              aria-label="项目名称"
              placeholder="项目名称"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              required
            />
          </label>
          <div className="project-source-heading">
            <span>源文件夹</span>
            {paths.length > 0 && (
              <button
                type="button"
                onClick={() => void pick()}
                disabled={paths.length >= 32}
              >
                <Plus size={13} />
                添加
              </button>
            )}
          </div>
          <div
            className={`project-sources ${paths.length ? "has-paths" : ""}`}
          >
            {paths.map((p) => (
              <div className="project-source" key={p}>
                <FolderOpen size={16} />
                <span title={p}>{p}</span>
                <button
                  type="button"
                  disabled={saved.current.has(p)}
                  aria-label={`移除目录 ${p}`}
                  onClick={() => setPaths((old) => old.filter((v) => v !== p))}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
            {!paths.length && (
              <>
                <FolderPlus size={24} />
                <p>在此电脑上添加文件夹</p>
                <button
                  type="button"
                  className="project-add-folder"
                  onClick={() => void pick()}
                >
                  {picking ? (
                    <LoaderCircle size={14} className="desktop-spin" />
                  ) : (
                    <Plus size={14} />
                  )}
                  添加文件夹
                </button>
              </>
            )}
          </div>
          {manual ? (
            <div className="project-manual-path">
              <input
                aria-label="文件夹路径"
                placeholder="输入文件夹的绝对路径"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    add(path);
                  }
                }}
              />
              <button
                type="button"
                disabled={!path.trim() || paths.length >= 32}
                onClick={() => add(path)}
              >
                添加
              </button>
            </div>
          ) : (
            <button
              className="project-path-toggle"
              type="button"
              onClick={() => setManual(true)}
            >
              手动输入路径
            </button>
          )}
        </fieldset>
        {error && (
          <p role="alert" className="space-editor-error">
            {error}
          </p>
        )}
        <footer>
          <button
            type="button"
            disabled={busy || picking}
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="submit"
            className="space-primary"
            disabled={
              busy || picking || !name.trim() || Boolean(path.trim())
            }
          >
            {busy && <LoaderCircle size={14} className="desktop-spin" />}
            创建项目
          </button>
        </footer>
      </form>
    </CompactDialog>
  );
}
