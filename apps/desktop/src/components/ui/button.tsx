import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils.ts";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg text-[12.5px] font-medium transition-all duration-150 select-none cursor-pointer disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] active:scale-[0.98]",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--accent)] text-[var(--on-primary,#ffffff)] shadow-xs hover:brightness-110",
        secondary:
          "bg-[var(--raised)] text-[var(--fg)] border border-[var(--line)] hover:bg-[var(--hover)] hover:border-[var(--border)]",
        outline:
          "bg-[var(--surface)] text-[var(--fg)] border border-[var(--line)] hover:bg-[var(--hover)] hover:border-[var(--border)]",
        ghost:
          "bg-transparent text-[var(--ink-secondary)] hover:bg-[var(--hover)] hover:text-[var(--fg)]",
        destructive:
          "bg-[color-mix(in_srgb,var(--red)_14%,transparent)] text-[var(--red)] border border-[color-mix(in_srgb,var(--red)_28%,transparent)] hover:bg-[color-mix(in_srgb,var(--red)_22%,transparent)]",
      },
      size: {
        default: "h-9 px-3.5 py-2",
        sm: "h-8 rounded-lg px-3 text-[12px]",
        lg: "h-10 rounded-lg px-5 text-[13px]",
        icon: "size-8 rounded-lg",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

/** shadcn/ui 标准按钮组件 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      data-slot="button"
      type={type}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  ),
);
Button.displayName = "Button";
