import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils.ts";

/** shadcn/ui 风格的原生下拉选择器（完整兼容表单与自动化测试角色） */
export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement> & { wrapperClassName?: string }
>(({ className, wrapperClassName, children, ...props }, ref) => (
  <div className={cn("relative inline-flex min-w-0 items-center", wrapperClassName)}>
    <select
      ref={ref}
      data-slot="select"
      className={cn(
        "h-9 w-full min-w-0 appearance-none rounded-lg border border-[var(--line)] bg-[var(--bg)] py-1.5 pl-3 pr-8 text-[12.5px] text-[var(--fg)] transition-[border-color,box-shadow] duration-150 cursor-pointer focus-visible:outline-none focus-visible:border-[var(--accent)] focus-visible:ring-[3px] focus-visible:ring-[var(--accent-soft)] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </select>
    <ChevronDown
      size={14}
      aria-hidden="true"
      className="pointer-events-none absolute right-2.5 text-[var(--muted)]"
    />
  </div>
));
Select.displayName = "Select";
