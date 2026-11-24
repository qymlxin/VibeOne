import * as React from "react";
import { cn } from "../../lib/utils.ts";

/** shadcn/ui 标准多行文本域 */
export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    data-slot="textarea"
    className={cn(
      "flex min-h-[96px] w-full min-w-0 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-[12.5px] leading-relaxed text-[var(--fg)] placeholder:text-[var(--muted)] caret-[var(--accent)] transition-[border-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:border-[var(--accent)] focus-visible:ring-[3px] focus-visible:ring-[var(--accent-soft)] disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";
