import React from "react";
import { ChevronDown, ChevronRight, type LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils.ts";
import { Badge } from "../ui/badge.tsx";

const statusVariantMap: Record<
  string,
  "default" | "success" | "warning" | "destructive" | "secondary"
> = {
  completed: "success",
  in_progress: "default",
  pending: "warning",
  failed: "destructive",
  cancelled: "secondary",
};

/** 工具执行状态徽章 */
export function ToolStatusBadge({
  status,
  label,
}: {
  status?: string;
  label: string;
}) {
  return (
    <Badge
      variant={status ? (statusVariantMap[status] ?? "secondary") : "secondary"}
      className="px-2 py-0 text-[11px]"
    >
      {label}
    </Badge>
  );
}

/** 单个工具或思考条目折叠卡 */
export function ToolCallItem({
  kind,
  icon: Icon,
  title,
  tooltip,
  status,
  statusLabel,
  historyOrder,
  open,
  onToggle,
  children,
}: {
  kind: string;
  icon: LucideIcon;
  title: string;
  tooltip?: string;
  status?: string;
  statusLabel: string;
  historyOrder?: number;
  open: boolean;
  onToggle: (open: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <details
      className={cn(
        "desktop-activity-item group rounded-lg border border-transparent transition-colors hover:bg-[var(--hover)] open:border-[var(--line)] open:bg-[var(--surface)] open:px-3 open:py-1",
        kind,
      )}
      data-history-order={historyOrder}
      onToggle={(event) => onToggle(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2.5 py-2 text-[12.5px] select-none [&::-webkit-details-marker]:hidden">
        <span className="desktop-process-item-icon grid size-6 shrink-0 place-items-center rounded-md bg-[var(--hover)] text-[var(--ink-secondary)]">
          <Icon size={13} />
        </span>
        <span
          title={tooltip}
          className="min-w-0 flex-1 truncate font-medium text-[var(--fg)]"
        >
          {title}
        </span>
        <ToolStatusBadge status={status} label={statusLabel} />
        <ChevronDown
          size={13}
          className={cn(
            "shrink-0 text-[var(--muted)] transition-transform duration-150",
            open && "rotate-180",
          )}
        />
      </summary>
      {children}
    </details>
  );
}

/** 同类工具分组折叠卡片 */
export function ToolGroupCard({
  icon: Icon,
  label,
  failed,
  working,
  bodyClassName,
  historyOrder,
  onOpen,
  children,
}: {
  icon: LucideIcon;
  label: string;
  failed: boolean;
  working: boolean;
  bodyClassName: string;
  historyOrder?: number;
  onOpen: () => void;
  children: React.ReactNode;
}) {
  return (
    <details
      className="event-group desktop-tool-group my-3 rounded-lg"
      data-history-order={historyOrder}
      onToggle={(event) => {
        if (event.currentTarget.open) {
          onOpen();
        }
      }}
    >
      <summary className="inline-flex cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] font-medium text-[var(--ink-secondary)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--fg)] [&::-webkit-details-marker]:hidden">
        <Icon size={15} className="shrink-0 text-[var(--accent)]" />
        <span>{label}</span>
        {(failed || working) && (
          <Badge variant={failed ? "destructive" : "default"} className="py-0 text-[10.5px]">
            {failed ? "含失败" : "执行中"}
          </Badge>
        )}
        <ChevronRight size={14} className="shrink-0 text-[var(--muted)] transition-transform duration-150" />
      </summary>
      <div
        className={cn(
          bodyClassName,
          "mt-1.5 ml-3 space-y-1 border-l border-[var(--line)] pl-3",
        )}
      >
        {children}
      </div>
    </details>
  );
}
