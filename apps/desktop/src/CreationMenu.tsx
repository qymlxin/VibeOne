import React, { useEffect, useRef } from "react";
import { FolderPlus, Plus, Users } from "lucide-react";

export function CreationMenu({
  onAgent,
  onProject,
  children,
}: {
  onAgent: () => void;
  onProject: () => void;
  children?: React.ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement | null>(null);

  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        ref.current.open = false;
      }
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && ref.current?.open) {
        ref.current.open = false;
        ref.current.querySelector<HTMLElement>("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
    };
  }, []);

  const select = (action: () => void) => {
    if (ref.current) {
      ref.current.open = false;
    }
    action();
  };

  return (
    <details ref={ref} className="workbench-tool-menu creation-menu">
      <summary className="icon-button" aria-label="新建" title="新建">
        <Plus size={17} />
      </summary>
      <div>
        <button type="button" onClick={() => select(onAgent)}>
          <Users size={14} />
          创建 Agent
        </button>
        <button type="button" onClick={() => select(onProject)}>
          <FolderPlus size={14} />
          创建项目
        </button>
        {children}
      </div>
    </details>
  );
}
