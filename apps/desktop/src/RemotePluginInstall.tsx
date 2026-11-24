import React, { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  Download,
  FolderGit2,
  Search,
} from "lucide-react";
import type { JsonValue } from "@vibeone/client-contracts";
import type { PluginPackageEntry } from "../electron/ipc.ts";
import { Alert } from "./components/ui/alert.tsx";
import { Badge } from "./components/ui/badge.tsx";
import { Button } from "./components/ui/button.tsx";
import { Card } from "./components/ui/card.tsx";
import { Input } from "./components/ui/input.tsx";
import { invoke } from "./native.ts";
import { capabilityNames, PluginIcon } from "./plugin-presentation.tsx";
import type { PluginRecord, WorkbenchLike } from "./types.ts";

interface DiscoveredPackage extends PluginPackageEntry {
  error?: string;
  manifest: PluginRecord["manifest"] & { [key: string]: unknown };
}

interface CatalogState {
  packages: DiscoveredPackage[];
  warnings: string[];
  source: { repository: string; revision: string };
}

export interface PluginsController {
  install(body: {
    path: string;
    source?: unknown;
    trusted: boolean;
    workspaces: string[];
    config: Record<string, unknown>;
    expectedManifest: unknown;
  }): Promise<void>;
  disable(id: string): Promise<void>;
  registrations: readonly import("@vibeone/plugin-sdk/app").AppRegistration[];
  records: PluginRecord[];
  error: string;
}

export function RemotePluginInstall({
  workbench,
  plugins,
  source,
}: {
  workbench: WorkbenchLike;
  plugins: PluginsController;
  source?: PluginRecord["source"];
}) {
  const [repository, setRepository] = useState(
    "https://github.com/qymlxin/VibeOnePlugin",
  );
  const [catalog, setCatalog] = useState<CatalogState | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [workspaces, setWorkspaces] = useState<string[]>([]);
  const [trusted, setTrusted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<
    Record<string, { state: "success" | "failed"; message?: string }>
  >({});
  const [progress, setProgress] = useState("");
  const epoch = useRef(0);

  useEffect(() => () => {
    epoch.current++;
  }, []);

  const reset = () => {
    epoch.current++;
    setCatalog(null);
    setChosen([]);
    setTrusted(false);
    setResults({});
    setError("");
    setQuery("");
    setProgress("");
  };

  useEffect(() => {
    if (source?.repository && source.repository !== repository) {
      setRepository(source.repository);
      reset();
    }
  }, [source?.repository]);

  const selected = (catalog?.packages ?? []).filter((item) =>
    chosen.includes(item.path),
  );
  const permissions = [
    ...new Set(
      selected.flatMap((item) => item.manifest.hostRequirements ?? []),
    ),
  ];
  const rows = (catalog?.packages ?? []).filter((item) =>
    `${item.manifest.name ?? ""} ${item.manifest.id ?? ""} ${item.source.directory}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const eligible = rows.filter(
    (item) => !item.error && results[item.path]?.state !== "success",
  );
  const changeChosen = (next: string[]) => {
    setChosen(next);
    setTrusted(false);
  };

  async function discover() {
    const request = ++epoch.current;
    setBusy(true);
    setError("");
    setProgress("正在下载仓库…");
    setCatalog(null);
    setChosen([]);
    setTrusted(false);
    setResults({});
    try {
      const fetched = (await invoke("plugin_fetch", {
        repository,
      })) as CatalogState;
      if (request !== epoch.current) {
        return;
      }
      setProgress("正在检查插件清单…");
      // 分批检查清单，避免触发主机端并发生命周期操作上限
      const packages: DiscoveredPackage[] = [];
      for (let start = 0; start < fetched.packages.length; start += 3) {
        const checked = await Promise.all(
          fetched.packages.slice(start, start + 3).map(async (item) => {
            try {
              const manifest = (await workbench.managePlugin("inspect", {
                path: item.path,
              } as JsonValue & { id?: string })) as DiscoveredPackage["manifest"];
              return { ...item, manifest };
            } catch (reason) {
              return {
                ...item,
                manifest: {
                  name: String(
                    item.manifest?.name ?? item.source.directory ?? "",
                  ),
                  id:
                    typeof item.manifest?.id === "string"
                      ? item.manifest.id
                      : undefined,
                  version:
                    typeof item.manifest?.version === "string"
                      ? item.manifest.version
                      : undefined,
                },
                error:
                  reason instanceof Error ? reason.message : String(reason),
              };
            }
          }),
        );
        packages.push(...checked);
      }
      if (request !== epoch.current) {
        return;
      }
      const counts = new Map<string, number>();
      for (const item of packages) {
        const id = item.manifest.id ?? "";
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      for (const item of packages) {
        if ((counts.get(item.manifest.id ?? "") ?? 0) > 1) {
          item.error = "仓库中存在重复插件ID，请发布者修正后重新解析";
        }
      }
      setCatalog({ ...fetched, packages });
      setWorkspaces((workbench.workspaces ?? []).map((w) => w.id));
      setQuery("");
    } catch (reason) {
      if (request === epoch.current) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      if (request === epoch.current) {
        setBusy(false);
        setProgress("");
      }
    }
  }

  async function install() {
    const request = ++epoch.current;
    setBusy(true);
    setError("");
    const failed: string[] = [];
    for (const [index, item] of selected.entries()) {
      if (request !== epoch.current) {
        break;
      }
      setProgress(
        `正在安装 ${index + 1}/${selected.length} · ${item.manifest.name ?? item.manifest.id}`,
      );
      try {
        const installed = workbench.plugins?.find(
          (p) => p.id === item.manifest.id,
        );
        await plugins.install({
          path: item.path,
          source: item.source,
          trusted: true,
          workspaces,
          config: installed?.config ?? {},
          expectedManifest: item.manifest,
        });
        if (request === epoch.current) {
          setResults((current) => ({
            ...current,
            [item.path]: { state: "success" },
          }));
        }
      } catch (reason) {
        failed.push(item.path);
        if (request === epoch.current) {
          setResults((current) => ({
            ...current,
            [item.path]: {
              state: "failed",
              message:
                reason instanceof Error ? reason.message : String(reason),
            },
          }));
        }
      }
    }
    if (request === epoch.current) {
      setChosen(failed);
      setBusy(false);
      setTrusted(false);
      setProgress("");
    }
  }

  return (
    <section className="remote-plugin-install space-y-5">
      <div className="space-y-1.5">
        <h2 className="m-0 flex items-center gap-2 text-[16px] font-semibold text-[var(--fg)]">
          <FolderGit2 size={17} className="text-[var(--accent)]" />
          连接插件仓库
        </h2>
        <p className="m-0 max-w-[65ch] text-[12.5px] leading-relaxed text-[var(--ink-secondary)]">
          输入一个仓库地址，自动发现其中的插件，选择需要的功能安装或更新。
        </p>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[220px] flex-1 space-y-1.5 text-[12px] font-medium text-[var(--fg)]">
            <span>GitHub 仓库</span>
            <Input
              value={repository}
              disabled={busy}
              className="font-mono text-[12px]"
              onChange={(event) => {
                setRepository(event.target.value);
                reset();
              }}
              placeholder="https://github.com/owner/plugins"
            />
          </label>
          <Button
            disabled={busy || !repository.trim()}
            onClick={() => void discover()}
          >
            <Download size={14} />
            {busy ? "正在处理…" : catalog ? "重新解析" : "解析仓库"}
          </Button>
        </div>
      </Card>

      {busy && (
        <Alert variant="info" role="status">
          {progress}
        </Alert>
      )}
      {error && (
        <Alert variant="destructive" role="alert">
          {error}
        </Alert>
      )}

      {!catalog && !busy && (
        <Card className="flex min-h-[280px] flex-col items-center justify-center gap-2.5 p-8 text-center text-[var(--muted)]">
          <FolderGit2 size={36} strokeWidth={1.4} />
          <h3 className="m-0 mt-2 text-[16px] font-medium text-[var(--fg)]">
            一个仓库，按需添加功能
          </h3>
          <p className="m-0 max-w-[42ch] text-[12.5px] leading-relaxed">
            解析仓库后，选择需要的插件。安装前会展示访问权限，之后可以随时停用。
          </p>
          <span className="mt-2 text-[11px]">支持独立插件包与多插件仓库</span>
        </Card>
      )}

      {catalog && (
        <div className="repository-plugin-catalog space-y-4">
          <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div className="space-y-0.5">
              <strong className="block text-[13.5px] font-semibold text-[var(--fg)]">
                发现 {catalog.packages.length} 个插件
              </strong>
              <small className="font-mono text-[11.5px] text-[var(--muted)]">
                提交 {catalog.source.revision.slice(0, 12)} ·
                安装使用此次解析的版本
              </small>
            </div>
            <div className="relative w-full sm:w-56">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]"
              />
              <Input
                aria-label="筛选仓库插件"
                value={query}
                className="h-8 pl-8 text-[12px]"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索插件…"
              />
            </div>
          </header>

          {Boolean(catalog.packages.length) && (
            <label className="inline-flex cursor-pointer items-center gap-2 text-[12px] text-[var(--ink-secondary)]">
              <input
                type="checkbox"
                className="accent-[var(--accent)]"
                disabled={busy || !eligible.length}
                checked={
                  eligible.length > 0 &&
                  eligible.every((item) => chosen.includes(item.path))
                }
                onChange={(event) =>
                  changeChosen(
                    event.target.checked
                      ? [
                          ...new Set([
                            ...chosen,
                            ...eligible.map((item) => item.path),
                          ]),
                        ]
                      : chosen.filter(
                          (p) => !eligible.some((item) => item.path === p),
                        ),
                  )
                }
              />
              选择当前列表的可安装插件
            </label>
          )}

          <Card className="max-h-[360px] divide-y divide-[var(--line)] overflow-auto">
            {rows.map((item) => {
              const installed = workbench.plugins?.find(
                (p) => p.id === item.manifest.id,
              );
              const result = results[item.path];
              return (
                <label
                  key={item.path}
                  className={`flex items-center gap-3 px-4 py-3 transition-colors ${
                    item.error
                      ? "cursor-default opacity-75"
                      : "cursor-pointer hover:bg-[var(--hover)]"
                  } ${chosen.includes(item.path) ? "bg-[var(--selected)]" : ""}`}
                >
                  <input
                    type="checkbox"
                    aria-label={`选择${item.manifest.name}`}
                    className="shrink-0 accent-[var(--accent)]"
                    checked={chosen.includes(item.path)}
                    disabled={
                      busy ||
                      Boolean(item.error) ||
                      result?.state === "success"
                    }
                    onChange={(event) =>
                      changeChosen(
                        event.target.checked
                          ? [...chosen, item.path]
                          : chosen.filter((p) => p !== item.path),
                      )
                    }
                  />
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-[var(--line)] bg-[var(--bg)] text-[var(--ink-secondary)]">
                    <PluginIcon plugin={item} size={18} />
                  </span>
                  <span className="min-w-0 flex-1 space-y-0.5">
                    <strong className="flex items-baseline gap-2 text-[13px] font-medium text-[var(--fg)]">
                      <span className="truncate">{item.manifest.name}</span>
                      <span className="font-mono text-[11px] font-normal text-[var(--muted)]">
                        {item.manifest.version ?? "无版本"}
                      </span>
                    </strong>
                    <small className="block truncate text-[11.5px] text-[var(--muted)]">
                      {item.manifest.description || item.manifest.id} ·{" "}
                      {item.source.directory || "仓库根目录"}
                    </small>
                    {item.error && (
                      <em className="block text-[11.5px] not-italic text-[var(--red)] [overflow-wrap:anywhere]">
                        {item.error}
                      </em>
                    )}
                    {result?.state === "failed" && (
                      <em className="block text-[11.5px] not-italic text-[var(--red)] [overflow-wrap:anywhere]">
                        {result.message}
                      </em>
                    )}
                  </span>
                  <span className="shrink-0">
                    {result?.state === "success" ? (
                      <Badge variant="success">
                        <Check size={12} />
                        已安装
                      </Badge>
                    ) : result?.state === "failed" ? (
                      <Badge variant="destructive">
                        <AlertCircle size={12} />
                        安装失败
                      </Badge>
                    ) : installed ? (
                      <Badge variant="outline">
                        已安装 {installed.version}
                      </Badge>
                    ) : (
                      <Badge variant="secondary">未安装</Badge>
                    )}
                  </span>
                </label>
              );
            })}
          </Card>

          {!rows.length && (
            <p className="m-0 text-[12.5px] text-[var(--muted)]">
              {catalog.packages.length
                ? "没有匹配的插件。"
                : "未发现插件包。仓库应在根目录或子目录中包含 plugin.json 及构建产物。"}
            </p>
          )}

          {Boolean(catalog.warnings.length) && (
            <details className="text-[12px] text-[var(--muted)]">
              <summary className="cursor-pointer hover:text-[var(--fg)]">
                有 {catalog.warnings.length} 个目录未能解析
              </summary>
              <div className="mt-2 space-y-1 pl-3">
                {catalog.warnings.map((warning, index) => (
                  <p key={index} className="m-0">
                    {warning}
                  </p>
                ))}
              </div>
            </details>
          )}

          {selected.length > 0 && (
            <Card className="space-y-3 border border-[color-mix(in_srgb,var(--accent)_30%,var(--line))] p-5">
              <strong className="block text-[13.5px] font-semibold text-[var(--fg)]">
                已选 {selected.length} 个插件
              </strong>
              <p className="m-0 text-[12.5px] text-[var(--ink-secondary)]">
                所需权限：
                {permissions.map((p) => capabilityNames[p] ?? p).join("、") ||
                  "无"}
              </p>
              {permissions.some((p) =>
                [
                  "workspace.read",
                  "artifact.write",
                  "desktop.terminal",
                ].includes(p),
              ) && (
                <fieldset className="space-y-2 rounded-lg border border-[var(--line)] bg-[var(--bg)] p-3">
                  <legend className="px-1 text-[11.5px] font-medium text-[var(--muted)]">
                    授权工作目录（应用于本次选中的插件）
                  </legend>
                  <div className="flex flex-wrap gap-2">
                    {(workbench.workspaces ?? []).map((w) => (
                      <label
                        key={w.id}
                        className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1 text-[12px]"
                      >
                        <input
                          type="checkbox"
                          className="accent-[var(--accent)]"
                          disabled={busy}
                          checked={workspaces.includes(w.id)}
                          onChange={(event) => {
                            setWorkspaces((current) =>
                              event.target.checked
                                ? [...current, w.id]
                                : current.filter((id) => id !== w.id),
                            );
                            setTrusted(false);
                          }}
                        />
                        {w.name}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <label className="inline-flex cursor-pointer items-center gap-2 text-[12.5px] font-medium text-[var(--fg)]">
                  <input
                    type="checkbox"
                    className="accent-[var(--accent)]"
                    disabled={busy}
                    checked={trusted}
                    onChange={(event) => setTrusted(event.target.checked)}
                  />
                  信任选中的插件及上述权限
                </label>
                <Button
                  size="sm"
                  disabled={busy || !trusted}
                  onClick={() => void install()}
                >
                  安装 / 更新所选 {selected.length} 个插件
                </Button>
              </div>
            </Card>
          )}

          {Object.values(results).some(
            (result) => result.state === "success",
          ) && (
            <Alert variant="info" role="status">
              已成功安装{" "}
              {
                Object.values(results).filter(
                  (result) => result.state === "success",
                ).length
              }{" "}
              个插件并启用，无需重启桌面。
              {Object.values(results).some(
                (result) => result.state === "failed",
              )
                ? "失败的插件可单独重试，成功项不会重复安装。"
                : ""}
            </Alert>
          )}
        </div>
      )}
    </section>
  );
}
