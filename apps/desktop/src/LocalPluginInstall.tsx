import React from "react";
import { Check, FolderOpen } from "lucide-react";
import { capabilityNames, PluginIcon } from "./plugin-presentation.tsx";
import type { PluginRecord } from "./types.ts";

export interface LocalInspectionManifest {
  id: string;
  name?: string;
  version?: string;
  hostRequirements?: string[];
  [key: string]: unknown;
}

export function LocalPluginInstall({
  path,
  onPath,
  inspection,
  busy,
  workspaces,
  selected,
  onSelected,
  config,
  onConfig,
  trusted,
  onTrusted,
  onChoose,
  onInspect,
  onExample,
  onInstall,
}: {
  path: string;
  onPath: (value: string) => void;
  inspection: LocalInspectionManifest | PluginRecord["manifest"] | null;
  busy: boolean;
  workspaces: Array<{ id: string; name: string; path: string }>;
  selected: string[];
  onSelected: (ids: string[]) => void;
  config: string;
  onConfig: (value: string) => void;
  trusted: boolean;
  onTrusted: (value: boolean) => void;
  onChoose: () => void;
  onInspect: () => void;
  onExample: () => void;
  onInstall: () => void;
}) {
  const requiresWorkspace = inspection?.hostRequirements?.some((p) =>
    ["workspace.read", "artifact.write", "desktop.terminal", "agent.spawn"].includes(
      p,
    ),
  );

  return (
    <div className="plugin-local-editor">
      <label className="plugin-local-label" htmlFor="local-plugin-path">
        插件包目录
      </label>
      <div className="plugin-local-path">
        <FolderOpen size={15} />
        <input
          id="local-plugin-path"
          value={path}
          disabled={busy}
          placeholder="选择包含 plugin.json 的目录"
          onChange={(event) => onPath(event.target.value)}
        />
        <button disabled={busy} onClick={onChoose}>
          浏览
        </button>
        <button disabled={busy || !path} onClick={onInspect}>
          {busy ? "检查中…" : "检查"}
        </button>
      </div>
      {inspection && (
        <>
          <div className="plugin-local-package">
            <span className="plugin-list-icon">
              <PluginIcon plugin={{ manifest: inspection }} size={22} />
            </span>
            <div>
              <strong>{inspection.name ?? inspection.id}</strong>
              <small>v{inspection.version}</small>
            </div>
            <span>
              <Check size={12} />
              已检查
            </span>
          </div>
          <section className="plugin-local-section">
            <h3>所需权限</h3>
            <div className="plugin-tags">
              {(inspection.hostRequirements ?? []).map((p) => (
                <span key={p}>{capabilityNames[p] ?? p}</span>
              ))}
              {!inspection.hostRequirements?.length && (
                <span>无需额外权限</span>
              )}
            </div>
          </section>
          {requiresWorkspace && (
            <fieldset className="plugin-local-workspaces">
              <legend>授权工作目录</legend>
              {workspaces.map((workspace) => (
                <label key={workspace.id} title={workspace.path}>
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={selected.includes(workspace.id)}
                    onChange={(event) =>
                      onSelected(
                        event.target.checked
                          ? [...selected, workspace.id]
                          : selected.filter((id) => id !== workspace.id),
                      )
                    }
                  />
                  <FolderOpen size={12} />
                  <span>{workspace.name}</span>
                </label>
              ))}
              {!workspaces.length && <p>尚无可授权的工作目录。</p>}
            </fieldset>
          )}
          <details className="plugin-local-configuration">
            <summary>
              插件配置 <span>JSON</span>
            </summary>
            <label>
              <textarea
                aria-label="插件配置（JSON）"
                value={config}
                disabled={busy}
                onChange={(event) => onConfig(event.target.value)}
              />
            </label>
          </details>
          <label className="plugin-local-trust">
            <input
              type="checkbox"
              checked={trusted}
              disabled={busy}
              onChange={(event) => onTrusted(event.target.checked)}
            />
            信任此插件及上述权限
          </label>
          <footer>
            <span>安装后立即启用，无需重启应用。</span>
            <button
              className="plugin-primary"
              disabled={busy || !trusted}
              onClick={onInstall}
            >
              {busy ? "正在保存…" : "保存并启用"}
            </button>
          </footer>
        </>
      )}
      <details className="plugin-local-development">
        <summary>开发选项</summary>
        <button disabled={busy} onClick={onExample}>
          选择内置示例插件
        </button>
      </details>
    </div>
  );
}
