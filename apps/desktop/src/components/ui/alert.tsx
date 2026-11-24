import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils.ts";

const alertVariants = cva(
  "flex items-start gap-2.5 rounded-xl px-4 py-3 text-[12.5px] leading-relaxed",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--surface)] text-[var(--ink-secondary)] shadow-[var(--card-shadow)]",
        info: "bg-[var(--accent-soft)] text-[var(--fg)] border border-[color-mix(in_srgb,var(--accent)_25%,transparent)]",
        warning:
          "bg-[var(--warning-bg)] text-[var(--warning)] border border-[color-mix(in_srgb,var(--warning)_25%,transparent)]",
        destructive:
          "bg-[var(--remove)] text-[var(--red)] border border-[color-mix(in_srgb,var(--red)_28%,transparent)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export type AlertProps = React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof alertVariants>;

/** shadcn/ui 提示横幅组件 */
export function Alert({ className, variant, ...props }: AlertProps) {
  return (
    <div
      data-slot="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}
