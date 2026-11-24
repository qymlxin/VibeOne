import React from "react";
import { ChevronRight, GitCompareArrows } from "lucide-react";
import { cn } from "../../lib/utils.ts";
import { Badge } from "../ui/badge.tsx";

/** 单轮对话文件变更摘要卡（参照 AI Elements 风格卡片） */
export function TurnChangesCard({
  fileCount,
  added = 0,
  removed = 0,
  onClick,
  className,
}: {
  fileCount: number;
  added?: number;
  removed?: number;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      data-slot="turn-changes-card"
      onClick={onClick}
      className={cn(
        "change-summary group flex w-full items-center gap-3.5 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-left text-[var(--fg)] shadow-[var(--card-shadow)] transition-all duration-150 hover:border-[var(--border)] hover:bg-[var(--raised)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
        className,
      )}
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
        <GitCompareArrows size={16} />
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <strong className="block text-[13px] font-semibold text-[var(--fg)] group-hover:text-[var(--accent)]">
          查看本轮变更
        </strong>
        <span className="flex flex-wrap items-center gap-2 text-[11.5px] text-[var(--muted)]">
          <span>{fileCount} 个文件</span>
          <em className="not-italic font-mono font-medium text-[var(--green)]">
            +{added}
          </em>
          <b className="font-mono font-medium text-[var(--red)]">−{removed}</b>
          <span>· 执行前后差异</span>
        </span>
      </div>
      <Badge variant="outline" className="hidden sm:inline-flex">
        查看差异
      </Badge>
      <ChevronRight
        size={15}
        className="shrink-0 text-[var(--muted)] transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-[var(--fg)]"
      />
    </button>
  );
}
