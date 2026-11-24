import * as React from "react";
import { cn } from "../../lib/utils.ts";
import { Card } from "./card.tsx";

/** 设置分组容器：包含标题、描述和统一分割线的悬浮阴影卡片 */
export function SettingSection({
  title,
  description,
  children,
  className,
  "aria-label": ariaLabel,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <section
      aria-label={ariaLabel}
      className={cn("my-7 space-y-2.5", className)}
    >
      <div className="space-y-1 px-0.5">
        <h2 className="m-0 text-[13.5px] font-semibold tracking-tight text-[var(--fg)]">
          {title}
        </h2>
        {description && (
          <p className="m-0 text-[12px] leading-relaxed text-[var(--muted)]">
            {description}
          </p>
        )}
      </div>
      <Card className="divide-y divide-[var(--line)] overflow-hidden">
        {children}
      </Card>
    </section>
  );
}

/** 设置标准行：左文右控，窄屏自动折行不挤压 */
export function SettingItem({
  title,
  description,
  children,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6",
        className,
      )}
    >
      <div className="min-w-0 flex-1 space-y-1">
        <div className="text-[13.5px] font-medium text-[var(--fg)]">
          {title}
        </div>
        {description && (
          <p className="m-0 max-w-[48ch] text-[12px] leading-relaxed text-[var(--muted)] [overflow-wrap:anywhere]">
            {description}
          </p>
        )}
      </div>
      {children != null && (
        <div className="flex shrink-0 flex-wrap items-center gap-2.5 text-[12.5px] text-[var(--ink-secondary)] sm:max-w-[56%] sm:justify-end">
          {children}
        </div>
      )}
    </div>
  );
}

/** 卡片内部自由排版区块（用于通栏文本域、代码块或表单操作栏） */
export function SettingBlock({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("px-5 py-4", className)}>{children}</div>;
}
