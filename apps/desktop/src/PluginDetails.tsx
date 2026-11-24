import React from "react";
import {
  ArrowUpRight,
  Folder,
  GitCommitHorizontal,
  Play,
  SlidersHorizontal,
} from "lucide-react";
import { Alert } from "./components/ui/alert.tsx";
import { Badge } from "./components/ui/badge.tsx";
import { Button } from "./components/ui/button.tsx";
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
      className="plugin-detail space-y-5"
      aria-label={`插件详情 ${plugin.name ?? plugin.id}`}
    >
      <header className="flex flex-wrap items-center gap-4">
        <span className="grid size-13 shrink-0 place-items-center rounded-xl border border-[var(--line)] bg-[var(--hover)] text-[var(--fg)]">
          <PluginIcon plugin={plugin} size={26} />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="m-0 text-[20px] font-semibold tracking-tight text-[var(--fg)] [overflow-wrap:anywhere]">
            {plugin.name ?? plugin.id}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11.5px] text-[var(--muted)]">
              v{plugin.version}
            </span>
            <Badge variant={plugin.enabled ? "success" : "secondary"}>
              <span
                className={`size-1.5 rounded-full ${
                  plugin.enabled ? "bg-[var(--green)]" : "bg-[var(--muted)]"
                }`}
              />
              {plugin.enabled ? "已启用" : "已停用"}
            </Badge>
          </div>
        </div>
        <SettingsSwitch
          label="启用插件"
          checked={Boolean(plugin.enabled)}
          disabled={busy}
          onChange={(enabled) => (enabled ? onEnable() : onDisable())}
        />
      </header>

      <p className="m-0 max-w-[65ch] text-[13px] leading-relaxed text-[var(--ink-secondary)]">
        {plugin.manifest?.description ||
          "为工作台提供额外功能，可独立安装、更新和停用。"}
      </p>

      {plugin.error && (
        <Alert variant="destructive" role="alert">
          {plugin.error}
        </Alert>
      )}

      <div className="flex flex-wrap gap-2 pb-1">
        {plugin.source && (
          <Button variant="outline" size="sm" disabled={busy} onClick={onUpdate}>
            <ArrowUpRight size={14} />
            检查仓库更新
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={onConfigure}
        >
          <SlidersHorizontal size={14} />
          配置与授权
        </Button>
      </div>

      <section className="space-y-2.5 border-t border-[var(--line)] pt-4">
        <h3 className="m-0 text-[12px] font-semibold text-[var(--fg)]">
          提供的功能
        </h3>
        {types.length ? (
          <div className="flex flex-wrap gap-1.5">
            {types.map((type) => (
              <Badge key={type} variant="outline">
                {type}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="m-0 text-[12px] text-[var(--muted)]">
            此插件尚未声明界面或命令。
          </p>
        )}
      </section>

      <section className="space-y-2.5 border-t border-[var(--line)] pt-4">
        <h3 className="m-0 flex items-center gap-2 text-[12px] font-semibold text-[var(--fg)]">
          访问权限
          <span className="font-normal text-[var(--muted)]">
            {capabilities.length} 项
          </span>
        </h3>
        {capabilities.length ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {capabilities.map((capability) => (
              <div
                key={capability}
                className="flex items-center gap-2 text-[12px] text-[var(--ink-secondary)]"
              >
                <span className="size-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                <span>{capabilityNames[capability] ?? capability}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="m-0 text-[12px] text-[var(--muted)]">不需要额外权限</p>
        )}
      </section>

      {scopes.length > 0 && (
        <section className="space-y-2.5 border-t border-[var(--line)] pt-4">
          <h3 className="m-0 flex items-center gap-2 text-[12px] font-semibold text-[var(--fg)]">
            授权的工作目录
            <span className="font-normal text-[var(--muted)]">
              {scopes.length}
            </span>
          </h3>
          <div className="flex max-h-[120px] flex-wrap gap-1.5 overflow-auto">
            {scopes.map((scope) => (
              <Badge
                key={scope.id}
                variant="secondary"
                title={
                  workspaces.find((w) => w.id === scope.id)?.path ?? scope.name
                }
                className="max-w-[200px]"
              >
                <Folder size={12} className="shrink-0" />
                <span className="truncate">{scope.name}</span>
              </Badge>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-1.5 border-t border-[var(--line)] pt-4">
        <h3 className="m-0 text-[12px] font-semibold text-[var(--fg)]">
          安装来源
        </h3>
        <div className="flex flex-col gap-1 text-[12px]">
          <span className="text-[var(--muted)]">
            {plugin.source ? "GitHub 仓库" : "本地插件包"}
          </span>
          <strong
            title={plugin.source?.repository ?? plugin.path}
            className="truncate font-mono text-[12px] font-normal text-[var(--fg)]"
          >
            {plugin.source
              ? plugin.source.repository.replace("https://github.com/", "")
              : plugin.path}
          </strong>
          {plugin.source && (
            <small className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-[var(--muted)]">
              <Folder size={12} />
              <span>{plugin.source.directory || "仓库根目录"}</span>
              <GitCommitHorizontal size={12} className="ml-1" />
              <span className="font-mono">
                {plugin.source.revision?.slice(0, 12)}
              </span>
            </small>
          )}
        </div>
      </section>

      {plugin.enabled && commands.length > 0 && (
        <section className="space-y-2.5 border-t border-[var(--line)] pt-4">
          <h3 className="m-0 text-[12px] font-semibold text-[var(--fg)]">
            插件命令
          </h3>
          <div className="flex flex-wrap gap-2">
            {commands.map((item) => (
              <Button
                key={item.id}
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => onInvoke(item)}
              >
                <Play size={12} />
                {item.title ?? item.id}
              </Button>
            ))}
          </div>
        </section>
      )}

      {children}

      <details className="plugin-technical border-t border-[var(--line)] pt-3 text-[11.5px] text-[var(--muted)]">
        <summary className="cursor-pointer select-none hover:text-[var(--fg)]">
          技术信息
        </summary>
        <dl className="mt-3 grid grid-cols-[84px_minmax(0,1fr)] gap-2">
          <dt>插件标识</dt>
          <dd className="m-0 font-mono [overflow-wrap:anywhere]">{plugin.id}</dd>
          <dt>安装路径</dt>
          <dd className="m-0 font-mono [overflow-wrap:anywhere]">
            {plugin.path}
          </dd>
          <dt>代次</dt>
          <dd className="m-0 font-mono">{plugin.generation}</dd>
        </dl>
      </details>
    </article>
  );
}
