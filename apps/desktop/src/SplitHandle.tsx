import React, { useEffect, useRef, useState } from "react";
import { paneDrag, paneRelease } from "./pane-resize.ts";

interface DragState {
  x: number;
  width: number;
  raw: number;
  maximum: number;
  app: HTMLElement;
  initialClosed: boolean;
  closed: boolean;
}

// 当面板折叠时保持把手挂载，确保拖拽手势与指针捕获不中断
export function SplitHandle({
  onResize,
  onCollapse,
  onExpand,
  collapsed = false,
  scope = "panel",
  minimum = 280,
  label = "调整右侧预览宽度",
  hidden = false,
}: {
  onResize: (width: number) => void;
  onCollapse?: () => void;
  onExpand?: () => void;
  collapsed?: boolean;
  scope?: "panel" | "sidebar" | "tree";
  minimum?: number;
  label?: string;
  hidden?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const drag = useRef<DragState | null>(null);
  const frame = useRef<number | null>(null);
  const latest = useRef({ onResize, onCollapse, onExpand, collapsed });
  latest.current = { onResize, onCollapse, onExpand, collapsed };

  const [measured, setMeasured] = useState(minimum);
  const side = scope === "sidebar" ? "sidebar" : "panel";
  const direction = scope === "sidebar" ? 1 : -1;

  const pane = (node: HTMLElement): Element | null =>
    scope === "sidebar"
      ? (node.closest(".review-app")?.querySelector(".sidebar-resize-slot") ??
        null)
      : node.nextElementSibling;

  const maximum = (node: HTMLElement): number => {
    if (scope === "tree") {
      return Math.max(0, (node.parentElement?.clientWidth ?? 0) - 164);
    }
    const app = node.closest<HTMLElement>(".review-app");
    if (!app) {
      return 2400;
    }
    const other = app.querySelector<HTMLElement>(
      scope === "sidebar"
        ? ".context-panel:not([hidden])"
        : ".sidebar-resize-slot:not([hidden])",
    );
    const available = Math.max(
      0,
      app.clientWidth - (other?.getBoundingClientRect().width ?? 0) - 328,
    );
    return scope === "sidebar" ? Math.min(480, available) : available;
  };

  const clear = (active: DragState | null) => {
    if (frame.current != null) {
      cancelAnimationFrame(frame.current);
    }
    frame.current = null;
    if (!active) {
      return;
    }
    const app = active.app;
    app.style.removeProperty(`--${side}-drag-width`);
    app.style.removeProperty(`--${side}-drag-opacity`);
    delete app.dataset.paneDrag;
    delete document.documentElement.dataset.panelResizing;
    window.dispatchEvent(
      new CustomEvent("vibeone:panel-resize", { detail: { active: false } }),
    );
  };

  const setOpen = (open: boolean) => {
    if (open) {
      latest.current.onExpand?.();
    } else {
      latest.current.onCollapse?.();
    }
  };

  const apply = () => {
    frame.current = null;
    const active = drag.current;
    if (!active) {
      return;
    }
    const result = paneDrag(active.raw, minimum, active.maximum);
    active.app.style.setProperty(`--${side}-drag-width`, `${result.width}px`);
    active.app.style.setProperty(
      `--${side}-drag-opacity`,
      String(result.opacity),
    );
    if (active.closed !== result.collapsed) {
      active.closed = result.collapsed;
      setOpen(!result.collapsed);
    }
  };

  const finish = (cancel = false) => {
    const active = drag.current;
    if (!active) {
      return;
    }
    if (frame.current != null) {
      cancelAnimationFrame(frame.current);
    }
    frame.current = null;
    if (!cancel) {
      apply();
    }
    drag.current = null;
    if (cancel) {
      latest.current.onResize(active.width || minimum);
      setOpen(!active.initialClosed);
    } else {
      const result = paneRelease(active.raw, minimum, active.maximum);
      latest.current.onResize(
        result.collapsed ? active.width || minimum : Math.round(result.width),
      );
      setOpen(!result.collapsed);
    }
    clear(active);
  };

  useEffect(() => {
    const node = ref.current;
    const target = node && pane(node);
    if (!target) {
      return;
    }
    const observer = new ResizeObserver(() =>
      setMeasured(Math.round(target.getBoundingClientRect().width)),
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [collapsed, scope]);

  useEffect(() => {
    const cancel = () => finish(true);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("blur", cancel);
      const active = drag.current;
      drag.current = null;
      clear(active);
    };
  }, []);

  return (
    <div
      ref={ref}
      hidden={hidden}
      className={`split-handle ${scope === "sidebar" ? "sidebar-resize" : scope === "tree" ? "file-tree-resize" : "panel-resize desktop-split-handle"} ${collapsed ? "is-collapsed" : ""}`}
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuenow={collapsed ? 0 : measured}
      aria-valuetext={
        collapsed
          ? "已收起，向外拖动可展开"
          : `${measured} 像素，继续拖窄可收起`
      }
      tabIndex={hidden ? -1 : 0}
      title="拖动调整宽度；拖过一半收起，保持按住可拖回；双击切换"
      onDoubleClick={() => setOpen(collapsed)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && drag.current) {
          event.preventDefault();
          finish(true);
          return;
        }
        if (
          !["Home", "End", "ArrowLeft", "ArrowRight"].includes(event.key)
        ) {
          return;
        }
        event.preventDefault();
        const max = maximum(event.currentTarget);
        const min = Math.min(minimum, max);
        const increase =
          event.key === (direction === 1 ? "ArrowRight" : "ArrowLeft");
        if (
          event.key === "Home" ||
          (!increase &&
            event.key !== "End" &&
            !collapsed &&
            measured <= min)
        ) {
          setOpen(false);
          return;
        }
        if (collapsed && !increase && event.key !== "End") {
          return;
        }
        latest.current.onResize(
          event.key === "End"
            ? max
            : collapsed
              ? min
              : Math.max(min, Math.min(max, measured + (increase ? 24 : -24))),
        );
        setOpen(true);
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || hidden) {
          return;
        }
        event.preventDefault();
        const node = event.currentTarget;
        const app = node.closest<HTMLElement>(".review-app");
        if (!app) {
          return;
        }
        node.focus({ preventScroll: true });
        node.setPointerCapture(event.pointerId);
        const width = collapsed
          ? 0
          : (pane(node)?.getBoundingClientRect().width ?? minimum);
        drag.current = {
          x: event.clientX,
          width,
          raw: width,
          maximum: maximum(node),
          app,
          initialClosed: collapsed,
          closed: collapsed,
        };
        app.dataset.paneDrag = side;
        document.documentElement.dataset.panelResizing = "true";
        window.dispatchEvent(
          new CustomEvent("vibeone:panel-resize", { detail: { active: true } }),
        );
      }}
      onPointerMove={(event) => {
        const active = drag.current;
        if (!active) {
          return;
        }
        active.raw = active.width + direction * (event.clientX - active.x);
        if (frame.current == null) {
          frame.current = requestAnimationFrame(apply);
        }
      }}
      onPointerUp={(event) => {
        if (drag.current) {
          drag.current.raw =
            drag.current.width + direction * (event.clientX - drag.current.x);
        }
        finish();
      }}
      onPointerCancel={() => finish(true)}
      onLostPointerCapture={() => finish()}
    />
  );
}
