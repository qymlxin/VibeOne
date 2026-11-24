import React, { useEffect, useMemo, useState } from "react";
import type { TimelineTurn } from "./chat-timeline.ts";

const excerpt = (text: unknown): string =>
  String(text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);

export function ConversationNav({
  turns,
  timeline,
  onNavigate,
}: {
  turns: TimelineTurn[];
  timeline: React.RefObject<HTMLElement | null>;
  onNavigate: () => void;
}) {
  const entries = useMemo(
    () =>
      turns.map((turn) => ({
        id: turn.id,
        title: excerpt(turn.user?.text) || "较早记录（未载入输入）",
        answer: excerpt(turn.answer?.text),
      })),
    [turns],
  );
  const ids = entries.map((entry) => entry.id).join("\n");
  const [active, setActive] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    const root = timeline.current;
    if (!root) {
      return;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      const nodes = [...root.querySelectorAll<HTMLElement>("[data-turn-id]")];
      const top =
        root.getBoundingClientRect().top +
        Math.min(100, root.clientHeight / 4);
      const atBottom =
        root.scrollHeight - root.scrollTop - root.clientHeight < 4;
      const current = atBottom
        ? nodes.at(-1)
        : (nodes.findLast((node) => node.getBoundingClientRect().top <= top) ??
          nodes[0]);
      setActive(current?.dataset.turnId ?? null);
    };
    const schedule = () => {
      if (!frame) {
        frame = requestAnimationFrame(update);
      }
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(root);
    root
      .querySelectorAll("[data-turn-id]")
      .forEach((node) => resize.observe(node));
    root.addEventListener("scroll", schedule, { passive: true });
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      root.removeEventListener("scroll", schedule);
    };
  }, [ids, timeline]);

  if (entries.length < 2) {
    return null;
  }
  const selected = entries.find((entry) => entry.id === preview);
  const previewIndex = entries.findIndex((item) => item.id === preview);

  return (
    <nav
      className="reading-rail desktop-conversation-nav"
      aria-label="对话导航"
      onMouseLeave={() => setPreview(null)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setPreview(null);
        }
      }}
    >
      <div className="reading-marks desktop-conversation-marks">
        {entries.map((entry, index) => (
          <button
            key={entry.id}
            type="button"
            aria-label={`跳转到第 ${index + 1} 轮：${entry.title || "空消息"}`}
            aria-current={active === entry.id ? "location" : undefined}
            onMouseEnter={() => setPreview(entry.id)}
            onFocus={() => setPreview(entry.id)}
            aria-describedby={
              preview === entry.id ? "conversation-nav-preview" : undefined
            }
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setPreview(null);
              }
              const buttons = [
                ...(event.currentTarget.parentElement?.children ?? []),
              ] as HTMLElement[];
              const keyMap: Record<string, number | undefined> = {
                ArrowDown: Math.min(index + 1, entries.length - 1),
                ArrowUp: Math.max(index - 1, 0),
                Home: 0,
                End: entries.length - 1,
              };
              const next = keyMap[event.key];
              if (next !== undefined) {
                event.preventDefault();
                buttons[next]?.focus();
              }
            }}
            onClick={() => {
              const root = timeline.current;
              if (!root) {
                return;
              }
              const node = [
                ...root.querySelectorAll<HTMLElement>("[data-turn-id]"),
              ].find((item) => item.dataset.turnId === entry.id);
              if (!node) {
                return;
              }
              onNavigate();
              root.scrollTop +=
                node.getBoundingClientRect().top -
                root.getBoundingClientRect().top -
                16;
              setActive(entry.id);
              setPreview(null);
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width:
                  preview === null
                    ? 8
                    : Math.max(8, 38 - Math.abs(index - previewIndex) * 7),
              }}
            />
          </button>
        ))}
      </div>
      {selected && (
        <div
          className="reading-preview desktop-conversation-preview"
          id="conversation-nav-preview"
          role="tooltip"
        >
          <strong>{selected.title || "空消息"}</strong>
          <p>{selected.answer || "查看这一轮处理过程"}</p>
        </div>
      )}
    </nav>
  );
}
