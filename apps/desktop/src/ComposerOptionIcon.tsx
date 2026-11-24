import React from "react";
import {
  Activity,
  Archive,
  BookOpen,
  BrainCircuit,
  Cable,
  CircleHelp,
  Command,
  Cpu,
  Eraser,
  FilePlus2,
  FileText,
  Folder,
  GitBranch,
  GitCommitHorizontal,
  GitCompareArrows,
  History,
  ListChecks,
  LogOut,
  MessageSquarePlus,
  Package,
  ScanEye,
  ShieldCheck,
  Shrink,
  SlidersHorizontal,
  Terminal,
  Users,
  type LucideIcon,
} from "lucide-react";
import { SessionAvatar } from "./SessionIdentity.tsx";

const icons: Record<string, LucideIcon> = {
  plan: ListChecks,
  mcp: Cable,
  skills: BookOpen,
  status: Activity,
  review: ScanEye,
  "review-branch": GitCompareArrows,
  "review-commit": GitCommitHorizontal,
  compact: Shrink,
  new: MessageSquarePlus,
  init: FilePlus2,
  help: CircleHelp,
  permissions: ShieldCheck,
  clear: Eraser,
  logout: LogOut,
  archive: Archive,
};

const panelIcons: Record<string, LucideIcon> = {
  terminal: Terminal,
  changes: GitBranch,
  runs: History,
  files: Folder,
  artifacts: Package,
  agent: SlidersHorizontal,
};

export interface ComposerOptionItem {
  kind?: string;
  control?: string;
  panel?: string;
  name?: string;
  color?: string;
  shape?: string;
}

export function ComposerOptionIcon({ item }: { item: ComposerOptionItem }) {
  if (item.kind === "agent") {
    return (
      <span className="composer-option-icon avatar">
        <SessionAvatar color={item.color} shape={item.shape} />
      </span>
    );
  }
  const Icon =
    item.control === "model"
      ? Cpu
      : item.control === "reasoning"
        ? BrainCircuit
        : item.control === "mode"
          ? SlidersHorizontal
          : item.kind === "skill"
            ? BookOpen
            : item.kind === "target"
              ? Users
              : item.kind === "config"
                ? SlidersHorizontal
                : (item.panel ? panelIcons[item.panel] : undefined) ??
                  (item.name ? icons[item.name] : undefined) ??
                  (item.kind === "directory"
                    ? Folder
                    : item.kind === "file"
                      ? FileText
                      : Command);
  return (
    <span
      className={`composer-option-icon ${item.kind === "skill" ? "skill" : ""}`}
    >
      <Icon size={16} strokeWidth={1.65} aria-hidden="true" />
    </span>
  );
}
