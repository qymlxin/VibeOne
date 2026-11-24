import React from "react";
import { Blocks, Folder, GitBranch, Globe, Terminal, type LucideIcon } from "lucide-react";
import type { PluginRecord } from "./types.ts";

export const capabilityNames: Record<string, string> = {
  "workspace.read": "读取工作目录",
  "artifact.write": "保存文本产物",
  "desktop.terminal": "使用交互终端",
  "desktop.browser": "浏览网页",
  "agent.spawn": "启动 Agent",
  "notifications.send": "发送通知",
};

const iconMap: Record<string, LucideIcon> = {
  folder: Folder,
  browser: Globe,
  changes: GitBranch,
  terminal: Terminal,
};

export function PluginIcon({
  plugin,
  size = 20,
}: {
  plugin: { manifest?: PluginRecord["manifest"] };
  size?: number;
}) {
  const contribution = (plugin.manifest?.contributions ?? []).find(
    (c) => c.surface === "workspace.tool",
  );
  const Icon = (contribution?.icon ? iconMap[contribution.icon] : undefined) ?? Blocks;
  return <Icon size={size} strokeWidth={1.7} aria-hidden="true" />;
}
