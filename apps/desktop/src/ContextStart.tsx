import React from "react";
import { ArrowUpRight, Folder, GitBranch, Terminal, type LucideIcon } from "lucide-react";
import { useWorkspaceExtensions } from "./workspace-extensions.tsx";

const icons: Record<string, LucideIcon> = {
  changes: GitBranch,
  terminal: Terminal,
  folder: Folder,
  browser: ArrowUpRight,
};

export function ContextStart({
  onChoose,
}: {
  onChoose: (id: string) => void;
}) {
  const { tools } = useWorkspaceExtensions();
  return (
    <section className="context-start">
      <h2 className="text-[13px] font-semibold tracking-tight text-foreground">
        工具
      </h2>
      <div className="grid gap-2.5">
        {tools
          .filter((tool) => tool.id !== "browser")
          .map((tool) => {
            const Icon = icons[tool.icon] ?? Folder;
            return (
              <button
                key={tool.id}
                type="button"
                data-slot="button"
                onClick={() => onChoose(tool.id)}
                className="group flex min-h-[72px] w-full items-center gap-3.5 rounded-xl border border-border/80 bg-card px-4 py-3.5 text-left text-foreground shadow-sm transition-[background-color,border-color,box-shadow] hover:border-border hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <span className="context-start-icon flex size-9 flex-none items-center justify-center rounded-lg border border-border/70 bg-background text-muted-foreground transition-colors group-hover:text-foreground">
                  <Icon size={18} />
                </span>
                <span className="grid min-w-0 flex-1 gap-1">
                  <strong className="truncate text-[13.5px] font-medium text-foreground">
                    {tool.title}
                  </strong>
                  <small className="truncate text-[11.5px] text-muted-foreground">
                    {tool.description}
                  </small>
                </span>
                <ArrowUpRight
                  size={16}
                  className="flex-none text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-foreground"
                />
              </button>
            );
          })}
      </div>
    </section>
  );
}
