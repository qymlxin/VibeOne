import React, { useState } from "react";
import {
  ArrowLeft,
  Bell,
  ChevronRight,
  Database,
  Folder,
  Globe,
  Info,
  Plug,
  RefreshCw,
  Search,
  Settings2,
  Sun,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import { AgentSettings } from "./AgentSettings.tsx";
import { BrandMark } from "./Brand.tsx";
import { Alert } from "./components/ui/alert.tsx";
import { Badge } from "./components/ui/badge.tsx";
import { Button } from "./components/ui/button.tsx";
import { Select } from "./components/ui/select.tsx";
import { Management } from "./Management.tsx";
import { NotificationSettings } from "./NotificationSettings.tsx";
import { PluginManager } from "./plugins.tsx";
import { ProjectSettings } from "./projects.tsx";
import { RemoteSettings } from "./Remote.tsx";
import type { PluginsController } from "./RemotePluginInstall.tsx";
import { SettingsAction, SettingsGroup, SettingsRow } from "./SettingsRows.tsx";
import { ArchivedConversations } from "./SidebarManagement.tsx";
import type {
  ProjectsController,
  SpacesController,
  WorkbenchLike,
} from "./types.ts";

const groups: Array<[string, string[]]> = [
  ["应用", ["general", "appearance", "notifications"]],
  ["工作方式", ["agents", "workspaces", "archived", "plugins"]],
  ["主机与设备", ["remote", "data"]],
];

const pages: Array<[string, string, LucideIcon, string]> = [
  ["general", "常规", Settings2, "主机 历史 会话"],
  ["appearance", "外观", Sun, "主题 颜色"],
  ["notifications", "通知", Bell, "审批 提醒"],
  ["agents", "Agent", Terminal, "配置 启动"],
  ["workspaces", "项目与目录", Folder, "项目 目录"],
  ["archived", "已归档对话", Database, "归档 删除 恢复 历史"],
  ["plugins", "插件", Plug, "安装 更新 权限"],
  ["remote", "远程连接", Globe, "手机 配对 证书 设备"],
  ["data", "数据与诊断", Database, "存储 重启 导出"],
];

export function SettingsCenter({
  workbench,
  plugins,
  theme,
  setTheme,
  onBack,
  appearance,
  projects,
  initialPage = "general",
  spaces,
  onOpenSession,
}: {
  workbench: WorkbenchLike;
  plugins: PluginsController;
  theme: string;
  setTheme: (theme: string) => void;
  onBack: () => void;
  appearance: React.ReactNode;
  projects: ProjectsController;
  initialPage?: string;
  spaces: SpacesController;
  onOpenSession: (id: string) => void;
}) {
  const [page, setPage] = useState(initialPage);
  const [query, setQuery] = useState("");
  const admin = !workbench.device;
  const available = pages.filter(
    ([id]) => admin || ["general", "appearance", "notifications"].includes(id),
  );
  const visible = available.filter(([, title, , keywords]) =>
    `${title} ${keywords}`.toLowerCase().includes(query.toLowerCase()),
  );
  const [error, setError] = useState("");
  const run = async (action: () => Promise<unknown>) => {
    setError("");
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const title = available.find(([id]) => id === page)?.[1] ?? "常规";
  const busy =
    workbench.sessions.some((session) =>
      ["starting", "running", "requires_action", "cancelling"].includes(
        session.status,
      ),
    ) ||
    (workbench.operations ?? []).some((operation) =>
      ["accepted", "running"].includes(operation.state),
    );

  const navigation = (
    <aside className="settings-navigation desktop-settings-navigation">
      <header>
        <button className="desktop-text-action" onClick={onBack}>
          <ArrowLeft size={14} />
          返回工作台
        </button>
      </header>
      <h2>设置</h2>
      <label className="settings-search">
        <Search size={14} />
        <input
          aria-label="搜索设置"
          placeholder="搜索设置"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <nav aria-label="设置分类">
        {groups.map(([label, ids]) => {
          const items = visible.filter(([id]) => ids.includes(id));
          return items.length ? (
            <section className="desktop-settings-nav-group" key={label}>
              <h3>{label}</h3>
              {items.map(([id, itemLabel, Icon]) => (
                <button
                  key={id}
                  aria-current={page === id ? "page" : undefined}
                  onClick={() => setPage(id)}
                >
                  <Icon size={15} />
                  {itemLabel}
                </button>
              ))}
            </section>
          ) : null;
        })}
        {!visible.length && <p>没有匹配的设置</p>}
      </nav>
      <footer>
        <BrandMark />
        <div>
          VibeOne
          <small>
            {admin ? "本机工作主机" : `设备权限：${workbench.device?.role}`}
          </small>
        </div>
      </footer>
    </aside>
  );

  return (
    <div className="desktop-settings-center">
      {navigation}
      {page === "appearance" ? (
        appearance
      ) : (
        <div className="settings-page desktop-settings-page" key={page}>
          <header className="settings-page-header">
            <span>设置 / {title}</span>
          </header>
          <div
            className={`settings-content desktop-settings-content ${["agents", "plugins"].includes(page) ? "settings-content-wide wide" : ""}`}
          >
            <h1>{title}</h1>
            {page === "general" && (
              <>
                <p className="settings-description">
                  连接、会话与执行的基本行为。
                </p>
                <SettingsGroup title="工作环境">
                  <SettingsRow
                    title="工作主机"
                    description="桌面关闭后，独立主机继续保存会话并承载执行。"
                  >
                    <Badge
                      variant={
                        workbench.phase === "online" ? "success" : "secondary"
                      }
                    >
                      {workbench.phase === "online"
                        ? "本机 · 已连接"
                        : workbench.phase}
                    </Badge>
                    <SettingsAction onClick={() => void workbench.reconnect()}>
                      <RefreshCw size={13} />
                      重新连接
                    </SettingsAction>
                  </SettingsRow>
                  <SettingsRow
                    title="Agent 接入"
                    description="已配置的启动入口。入口可用不等于工具已经认证。"
                  >
                    <span className="text-[12.5px] text-[var(--ink-secondary)]">
                      {workbench.providers
                        .map((provider) => provider.name)
                        .join("、")}
                    </span>
                    {admin && (
                      <SettingsAction onClick={() => setPage("agents")}>
                        管理
                        <ChevronRight size={13} />
                      </SettingsAction>
                    )}
                  </SettingsRow>
                  <SettingsRow title="界面语言">
                    <span className="text-[12.5px] text-[var(--ink-secondary)]">
                      简体中文
                    </span>
                  </SettingsRow>
                </SettingsGroup>
                <SettingsGroup title="会话与执行">
                  <SettingsRow
                    title="本地历史"
                    description="会话和配置统一持久保存，工程文件保留原路径。"
                  >
                    <span className="text-[12.5px] text-[var(--ink-secondary)]">
                      {workbench.persistent
                        ? "自动保存"
                        : "仅当前主机运行期间保留"}
                    </span>
                  </SettingsRow>
                  <SettingsRow
                    title="重启后的历史会话"
                    description="保留原消息；发送下一轮时默认续接原 Agent 上下文。"
                  >
                    <span className="text-[12.5px] text-[var(--ink-secondary)]">
                      不自动重放审批
                    </span>
                  </SettingsRow>
                  <SettingsRow
                    title="同一会话执行"
                    description="同一会话串行执行；可入队、撤回和暂停排队消息。"
                  >
                    <span className="text-[12.5px] text-[var(--ink-secondary)]">
                      最多 20 条排队消息
                    </span>
                  </SettingsRow>
                  {admin && (
                    <SettingsRow
                      title="数据目录"
                      description="无法写入主目录时，使用可写的兼容目录。"
                    >
                      <code className="rounded-md bg-[var(--hover)] px-2 py-1 font-mono text-[11.5px] text-[var(--ink-secondary)]">
                        {workbench.dataDirectory ?? "由主机管理"}
                      </code>
                      <SettingsAction onClick={() => setPage("data")}>
                        查看数据详情
                        <ChevronRight size={13} />
                      </SettingsAction>
                    </SettingsRow>
                  )}
                </SettingsGroup>
                <Alert className="mt-6">
                  <Info size={15} className="mt-0.5 shrink-0 text-[var(--accent)]" />
                  <span>
                    会话保存在本机。修改连接或启动配置不会自动开始执行任务。
                  </span>
                </Alert>
                {!admin && (
                  <p className="mt-3 text-[12px] text-[var(--muted)]">
                    设备角色及工作区范围由电脑端管理。
                  </p>
                )}
              </>
            )}
            {page === "appearance" &&
              (appearance ?? (
                <SettingsGroup title="视觉风格">
                  <SettingsRow title="模式">
                    <Select
                      aria-label="外观模式"
                      value={theme}
                      onChange={(event) => setTheme(event.target.value)}
                    >
                      <option value="system">跟随系统</option>
                      <option value="light">亮色</option>
                      <option value="dark">暗色</option>
                    </Select>
                  </SettingsRow>
                </SettingsGroup>
              ))}
            {page === "notifications" && <NotificationSettings />}
            {page === "agents" && admin && (
              <AgentSettings workbench={workbench} />
            )}
            {page === "archived" && admin && (
              <ArchivedConversations
                workbench={workbench}
                spaces={spaces}
                onOpen={onOpenSession}
              />
            )}
            {page === "workspaces" && admin && (
              <ProjectSettings projects={projects} workbench={workbench} />
            )}
            {page === "plugins" && admin && (
              <PluginManager workbench={workbench} plugins={plugins} />
            )}
            {page === "remote" && admin && (
              <RemoteSettings workbench={workbench} />
            )}
            {page === "data" && admin && (
              <>
                <SettingsGroup title="本地存储">
                  <SettingsRow
                    title="统一数据目录"
                    description={
                      workbench.persistent
                        ? "会话、配置和设备保存在本机 SQLite；工程文件保持原路径。"
                        : "当前主机尚未启用持久历史。"
                    }
                  >
                    <code className="rounded-md bg-[var(--hover)] px-2.5 py-1 font-mono text-[11.5px] text-[var(--ink-secondary)] [overflow-wrap:anywhere]">
                      {workbench.dataDirectory ?? "由主机管理"}
                    </code>
                  </SettingsRow>
                  {workbench.migrationPending && (
                    <div className="px-5 py-3 text-[12px] text-[var(--ink-secondary)]">
                      有任务使用旧目录，空闲重启后迁移。
                    </div>
                  )}
                  {workbench.migrationWarning && (
                    <div className="px-5 py-3">
                      <Alert variant="warning" role="status">
                        {workbench.migrationWarning}
                      </Alert>
                    </div>
                  )}
                </SettingsGroup>
                <SettingsGroup title="工作主机">
                  <SettingsRow
                    title="重启工作主机"
                    description="先结束全部执行；重启后保留会话，未恢复的上下文需明确继续。"
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={workbench.phase !== "online" || busy}
                      onClick={() => void run(workbench.restart)}
                    >
                      {workbench.phase === "upgrading"
                        ? "正在重启…"
                        : workbench.persistent
                          ? "重启工作主机"
                          : "保存会话并升级主机"}
                    </Button>
                  </SettingsRow>
                </SettingsGroup>
                <Management workbench={workbench} section="diagnostics" />
                <SettingsGroup title="通信信息">
                  <SettingsRow title="Agent">
                    <Badge variant="outline" className="font-mono">
                      ACP v2
                    </Badge>
                  </SettingsRow>
                  <SettingsRow title="插件">
                    <Badge variant="outline" className="font-mono">
                      Plugin RPC v1
                    </Badge>
                  </SettingsRow>
                </SettingsGroup>
              </>
            )}
            {error && (
              <Alert variant="destructive" role="alert" className="mt-4">
                {error}
              </Alert>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
