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
      <h2>工具</h2>
      <div>
        {tools
          .filter((tool) => tool.id !== "browser")
          .map((tool) => {
            const Icon = icons[tool.icon] ?? Folder;
            return (
              <button key={tool.id} onClick={() => onChoose(tool.id)}>
                <span className="context-start-icon">
                  <Icon size={20} />
                </span>
                <span>
                  <strong>{tool.title}</strong>
                  <small>{tool.description}</small>
                </span>
                <ArrowUpRight size={16} />
              </button>
            );
          })}
      </div>
    </section>
  );
}
