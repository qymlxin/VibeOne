import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils.ts";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11.5px] font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "bg-[var(--accent-soft)] text-[var(--accent)]",
        secondary: "bg-[var(--hover)] text-[var(--ink-secondary)]",
        success: "bg-[var(--add)] text-[var(--green)]",
        warning: "bg-[var(--warning-bg)] text-[var(--warning)]",
        destructive: "bg-[var(--remove)] text-[var(--red)]",
        outline:
          "border border-[var(--line)] bg-transparent text-[var(--ink-secondary)]",
      },
    },
    defaultVariants: {
      variant: "secondary",
    },
  },
);

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof badgeVariants>;

/** shadcn/ui 状态徽章组件 */
export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}
