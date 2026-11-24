import React, { useRef, useState } from "react";
import { FolderOpen, FolderPlus, LoaderCircle, Plus, X } from "lucide-react";
import { chooseWorkspace } from "./api.ts";
import { CompactDialog } from "./CompactDialog.tsx";
import { Alert } from "./components/ui/alert.tsx";
import { Button } from "./components/ui/button.tsx";
import { Input } from "./components/ui/input.tsx";
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
      <form onSubmit={submit} className="space-y-4">
        <fieldset disabled={busy || picking} className="space-y-4 border-0 px-5 py-1">
          <div className="relative">
            <FolderOpen
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]"
            />
            <Input
              autoFocus
              aria-label="项目名称"
              placeholder="项目名称"
              value={name}
              className="pl-9"
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              required
            />
          </div>

          <div className="flex items-center justify-between text-[12.5px] font-medium text-[var(--fg)]">
            <span>源文件夹</span>
            {paths.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void pick()}
                disabled={paths.length >= 32}
              >
                <Plus size={13} />
                添加
              </Button>
            )}
          </div>

          <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-2">
            {paths.length > 0 ? (
              <div className="max-h-[210px] divide-y divide-[var(--line)] overflow-auto">
                {paths.map((p) => (
                  <div
                    className="flex items-center gap-2.5 px-2.5 py-2 text-[12px]"
                    key={p}
                  >
                    <FolderOpen
                      size={15}
                      className="shrink-0 text-[var(--ink-secondary)]"
                    />
                    <span
                      title={p}
                      className="min-w-0 flex-1 font-mono text-[var(--fg)] [overflow-wrap:anywhere]"
                    >
                      {p}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={saved.current.has(p)}
                      aria-label={`移除目录 ${p}`}
                      onClick={() =>
                        setPaths((old) => old.filter((v) => v !== p))
                      }
                    >
                      <X size={14} />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex min-h-[136px] flex-col items-center justify-center gap-2.5 p-4 text-center text-[var(--muted)]">
                <FolderPlus size={24} strokeWidth={1.6} />
                <p className="m-0 text-[12.5px]">在此电脑上添加文件夹</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void pick()}
                >
                  {picking ? (
                    <LoaderCircle size={14} className="animate-spin" />
                  ) : (
                    <Plus size={14} />
                  )}
                  添加文件夹
                </Button>
              </div>
            )}
          </div>

          {manual ? (
            <div className="flex items-center gap-2">
              <Input
                aria-label="文件夹路径"
                placeholder="输入文件夹的绝对路径"
                value={path}
                className="font-mono text-[12px]"
                onChange={(e) => setPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    add(path);
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!path.trim() || paths.length >= 32}
                onClick={() => add(path)}
              >
                添加
              </Button>
            </div>
          ) : (
            <button
              className="project-path-toggle cursor-pointer bg-transparent p-0 text-[12px] text-[var(--muted)] hover:text-[var(--fg)]"
              type="button"
              onClick={() => setManual(true)}
            >
              手动输入路径
            </button>
          )}
        </fieldset>

        {error && (
          <div className="px-5">
            <Alert variant="destructive" role="alert">
              {error}
            </Alert>
          </div>
        )}

        <footer className="flex items-center justify-end gap-2 border-t border-[var(--line)] px-5 py-3.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || picking}
            onClick={onClose}
          >
            取消
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={busy || picking || !name.trim() || Boolean(path.trim())}
          >
            {busy && <LoaderCircle size={14} className="animate-spin" />}
            创建项目
          </Button>
        </footer>
      </form>
    </CompactDialog>
  );
}
