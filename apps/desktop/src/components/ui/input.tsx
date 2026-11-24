import * as React from "react";
import { cn } from "../../lib/utils.ts";

/** shadcn/ui 标准单行输入框 */
export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type = "text", ...props }, ref) => (
  <input
    ref={ref}
    data-slot="input"
    type={type}
    className={cn(
      "flex h-9 w-full min-w-0 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-1.5 text-[13px] text-[var(--fg)] placeholder:text-[var(--muted)] caret-[var(--accent)] transition-[border-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:border-[var(--accent)] focus-visible:ring-[3px] focus-visible:ring-[var(--accent-soft)] disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";
