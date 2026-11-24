import React from "react";
import {
  ArrowUpRight,
  Folder,
  GitCommitHorizontal,
  SlidersHorizontal,
} from "lucide-react";
import { capabilityNames, PluginIcon } from "./plugin-presentation.tsx";
import { SettingsSwitch } from "./SettingsRows.tsx";
import type { PluginContribution, PluginRecord } from "./types.ts";

const extensionNames: Record<string, string> = {
  "app.panel": "工作区面板",
  "app.command": "快捷命令",
  "settings.section": "设置界面",
  "agent.provider": "Agent 接入",
  "notification.channel": "事件通知",
};

export function PluginDetails({
  plugin,
  workspaces,
  busy,
  onDisable,
  onEnable,
  onConfigure,
  onUpdate,
  onInvoke,
  children,
}: {
  plugin: PluginRecord;
  workspaces: Array<{ id: string; name: string; path: string }>;
  busy: boolean;
  onDisable: () => void;
  onEnable: () => void;
  onConfigure: () => void;
  onUpdate: () => void;
  onInvoke: (item: PluginContribution) => void;
  children?: React.ReactNode;
}) {
  const contributions = plugin.manifest?.contributions ?? [];
  const scopes = (plugin.workspaces ?? []).map((id) => ({
    id,
    name: workspaces.find((w) => w.id === id)?.name ?? id,
  }));
  const commands = contributions.filter(
    (item) => item.kind === "app.command" && item.binding?.type === "worker",
  );
  const capabilities = plugin.capabilities ?? [];
  const types = [
    ...new Set(contributions.map((c) => extensionNames[c.kind] ?? c.kind)),
  ];

  return (
    <article
      className="plugin-detail"
      aria-label={`插件详情 ${plugin.name ?? plugin.id}`}
    >
      <header className="plugin-detail-heading">
        <span className="plugin-detail-icon">
          <PluginIcon plugin={plugin} size={26} />
        </span>
        <div>
          <h2>{plugin.name ?? plugin.id}</h2>
          <span className="plugin-version">v{plugin.version}</span>
          <span className={`plugin-status ${plugin.enabled ? "enabled" : ""}`}>
            <i />
            {plugin.enabled ? "已启用" : "已停用"}
          </span>
        </div>
        <SettingsSwitch
          label="启用插件"
          checked={Boolean(plugin.enabled)}
          disabled={busy}
          onChange={(enabled) => (enabled ? onEnable() : onDisable())}
        />
      </header>
      <p className="plugin-description">
        {plugin.manifest?.description ||
          "为工作台提供额外功能，可独立安装、更新和停用。"}
      </p>
      {plugin.error && (
        <p role="alert" className="plugin-feedback error">
          {plugin.error}
        </p>
      )}
      <div className="plugin-detail-actions">
        {plugin.source && (
          <button disabled={busy} onClick={onUpdate}>
            <ArrowUpRight size={14} />
            检查仓库更新
          </button>
        )}
        <button disabled={busy} onClick={onConfigure}>
          <SlidersHorizontal size={14} />
          配置与授权
        </button>
      </div>
      <section className="plugin-detail-section">
        <h3>提供的功能</h3>
        <div className="plugin-tags">
          {types.map((type) => (
            <span key={type}>{type}</span>
          ))}
        </div>
        {!types.length && <p>此插件尚未声明界面或命令。</p>}
      </section>
      <section className="plugin-detail-section">
        <h3>
          访问权限<span>{capabilities.length} 项</span>
        </h3>
        {capabilities.length ? (
          <div className="plugin-permissions">
            {capabilities.map((capability) => (
              <div key={capability}>
                <span className="plugin-permission-dot" />
                <span>{capabilityNames[capability] ?? capability}</span>
              </div>
            ))}
          </div>
        ) : (
          <p>不需要额外权限</p>
        )}
      </section>
      {scopes.length > 0 && (
        <section className="plugin-detail-section">
          <h3>
            授权的工作目录<span>{scopes.length}</span>
          </h3>
          <div className="plugin-scopes">
            {scopes.map((scope) => (
              <span
                title={
                  workspaces.find((w) => w.id === scope.id)?.path ?? scope.name
                }
                key={scope.id}
              >
                <Folder size={12} />
                <span>{scope.name}</span>
              </span>
            ))}
          </div>
        </section>
      )}
      <section className="plugin-detail-section">
        <h3>安装来源</h3>
        <div className="plugin-source">
          <span>{plugin.source ? "GitHub 仓库" : "本地插件包"}</span>
          <strong title={plugin.source?.repository ?? plugin.path}>
            {plugin.source
              ? plugin.source.repository.replace("https://github.com/", "")
              : plugin.path}
          </strong>
          {plugin.source && (
            <small>
              <Folder size={12} />
              {plugin.source.directory || "仓库根目录"}
              <GitCommitHorizontal size={12} />
              {plugin.source.revision?.slice(0, 12)}
            </small>
          )}
        </div>
      </section>
      {plugin.enabled && commands.length > 0 && (
        <section className="plugin-detail-section">
          <h3>插件命令</h3>
          {commands.map((item) => (
            <button
              key={item.id}
              disabled={busy}
              onClick={() => onInvoke(item)}
            >
              {item.title ?? item.id}
            </button>
          ))}
        </section>
      )}
      {children}
      <details className="plugin-technical">
        <summary>技术信息</summary>
        <dl>
          <dt>插件 ID</dt>
          <dd>{plugin.id}</dd>
          <dt>运行代次</dt>
          <dd>{plugin.generation}</dd>
          <dt>安装路径</dt>
          <dd>{plugin.path}</dd>
        </dl>
      </details>
    </article>
  );
}
