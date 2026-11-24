import React, { createContext, useContext } from "react";
import type { AppPanelProps, AppRegistration } from "@vibeone/plugin-sdk/app";
import type { DesktopSession, PluginRecord, WorkbenchLike } from "./types.ts";

export interface WorkspaceToolItem {
  id: string;
  contributionId: string;
  title: string;
  description: string;
  icon: string;
  Component: NonNullable<ReturnType<AppRegistration["panels"]["get"]>>;
  generation: number;
}

interface WorkspaceExtensionsContextValue {
  tools: WorkspaceToolItem[];
  builtins: Array<{ id: string }>;
  theme: "dark" | "light";
  panelParams: Record<string, Record<string, unknown>>;
  error?: string;
}

const Context = createContext<WorkspaceExtensionsContextValue>({
  tools: [],
  builtins: [],
  theme: "dark",
  panelParams: {},
});

export const useWorkspaceExtensions = () => useContext(Context);

const aliases = new Map(
  ["files", "changes", "terminal", "browser"].map((id) => [
    `dev.vibeone.${id}:${id}`,
    id,
  ]),
);

export function WorkspaceExtensions({
  plugins,
  theme = "dark",
  panelParams = {},
  children,
}: {
  plugins?: {
    registrations: readonly AppRegistration[];
    records: PluginRecord[];
    error: string;
  };
  theme?: "dark" | "light";
  panelParams?: Record<string, Record<string, unknown>>;
  children: React.ReactNode;
}) {
  const tools: WorkspaceToolItem[] = [];
  for (const app of plugins?.registrations ?? []) {
    const record = plugins?.records?.find(
      (item) =>
        item.id === app.identity.pluginId &&
        item.enabled &&
        item.generation === app.identity.generation,
    );
    for (const contribution of record?.manifest.contributions ?? []) {
      if (
        contribution.kind !== "app.panel" ||
        contribution.surface !== "workspace.tool"
      ) {
        continue;
      }
      const Component = app.panels.get(contribution.id);
      if (Component) {
        tools.push({
          id:
            aliases.get(`${record!.id}:${contribution.id}`) ??
            `plugin:${record!.id}:${contribution.id}`,
          contributionId: contribution.id,
          title: String(contribution.title ?? contribution.id),
          description: String(
            contribution.description ?? record!.name ?? record!.id,
          ),
          icon: String(contribution.icon ?? "extension"),
          Component,
          generation: app.identity.generation,
        });
      }
    }
  }

  return (
    <Context.Provider
      value={{
        tools,
        builtins: ["files", "changes", "terminal", "browser"].map((id) => ({
          id,
        })),
        theme,
        panelParams,
        error: plugins?.error,
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function WorkspaceTool({
  kind,
  session,
  workbench,
  ...props
}: {
  kind: string;
  session?: DesktopSession;
  workbench?: WorkbenchLike;
  fileTarget?: { path: string };
  visible?: boolean;
  initialUrl?: string;
  onTitle?: (title: string) => void;
  onNavigate?: (url: string) => void;
  emptyState?: React.ReactNode;
  [key: string]: unknown;
}) {
  const { tools, error, theme, panelParams } = useWorkspaceExtensions();
  const tool = tools.find((item) => item.id === kind);
  if (!tool) {
    return (
      <div className="context-tool-failure" role="status">
        <h2>{error ? "工具加载失败" : "工具插件未启用"}</h2>
        <p>可在设置 → 插件中安装或启用此工作区工具。</p>
        {error && <p>{error}</p>}
      </div>
    );
  }
  const Component = tool.Component;
  const workspaceId =
    session?.workspaceId ??
    workbench?.workspaces?.find(
      (workspace) => workspace.path === session?.workspace,
    )?.id;

  return (
    <React.Fragment key={tool.generation}>
      {Component({
        panelId: tool.contributionId,
        theme,
        params: (panelParams[tool.id] ??
          panelParams[tool.contributionId]) as AppPanelProps["params"],
        fileTarget: props.fileTarget,
        visible: props.visible,
        initialUrl: props.initialUrl,
        onTitle: props.onTitle,
        onNavigate: props.onNavigate,
        emptyState: props.emptyState,
        sessionId: session?.id,
        workspaceId,
      }) as React.ReactNode}
    </React.Fragment>
  );
}
