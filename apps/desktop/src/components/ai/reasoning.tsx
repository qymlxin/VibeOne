import React from "react";
import { ChevronRight, LoaderCircle } from "lucide-react";
import { cn } from "../../lib/utils.ts";

/** Agent 处理过程与流式思维链折叠容器 */
export function ReasoningActivityShell({
  live,
  expanded,
  hasActivity,
  label,
  elapsedText,
  motion,
  motionTargetRef,
  onToggle,
  preview,
  history,
}: {
  live: boolean;
  expanded: boolean;
  hasActivity: boolean;
  label: string;
  elapsedText?: string;
  motion: boolean;
  motionTargetRef: React.RefObject<HTMLSpanElement | null>;
  onToggle?: () => void;
  preview?: React.ReactNode;
  history?: React.ReactNode;
}) {
  const StatusElement = hasActivity ? "button" : "div";

  return (
    <section
      className="desktop-activity mb-3 rounded-xl border border-[var(--line)] bg-[var(--surface)]/75 px-3.5 py-2 text-[12.5px] text-[var(--muted)]"
      aria-label="Agent 处理过程"
      data-live={live}
    >
      <StatusElement
        className={cn(
          "turn-status desktop-activity-toggle flex w-full items-center gap-2 border-0 bg-transparent py-1 text-left font-medium text-[var(--ink-secondary)]",
          hasActivity && "cursor-pointer hover:text-[var(--fg)]",
          expanded && hasActivity && "border-b border-[var(--line)] pb-2",
        )}
        type={hasActivity ? "button" : undefined}
        aria-label={
          hasActivity
            ? `${label}，${expanded ? "收起过程" : "查看过程"}`
            : undefined
        }
        aria-expanded={hasActivity ? expanded : undefined}
        onClick={onToggle}
      >
        {live && (
          <LoaderCircle
            className="desktop-spin shrink-0 text-[var(--accent)]"
            size={14}
            aria-hidden="true"
          />
        )}
        <span
          ref={motionTargetRef}
          role={live ? "status" : undefined}
          className={cn(
            "text-[12.5px] font-medium text-[var(--fg)]",
            motion && "thinking-shimmer",
          )}
        >
          {label}
        </span>
        {elapsedText && (
          <time className="rounded bg-[var(--hover)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--muted)]">
            {elapsedText}
          </time>
        )}
        {hasActivity && (
          <ChevronRight
            size={14}
            className={cn(
              "ml-auto shrink-0 text-[var(--muted)] transition-transform duration-150",
              expanded && "rotate-90 expanded",
            )}
          />
        )}
      </StatusElement>
      {!expanded && live && preview}
      {expanded && history}
    </section>
  );
}
