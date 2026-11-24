import type { TimelineMessage, TimelineTool } from "./chat-timeline.ts";

export interface HistoryItemBase {
  id?: string;
  toolCallId?: string;
  role?: string;
  runId?: string | null;
  historyOrder?: number;
  historyRevision?: number;
  activityOrder?: number;
  [key: string]: unknown;
}

export type HistoryRecord =
  | { kind: "message"; item: TimelineMessage }
  | { kind: "tool"; item: TimelineTool };

export interface HistoryAnchor {
  order?: string;
  turn?: string;
  offset: number;
}

const ordered = (item: HistoryItemBase | null | undefined): boolean =>
  typeof item?.historyOrder === "number" &&
  Number.isSafeInteger(item.historyOrder) &&
  item.historyOrder > 0;

const identity = ({ kind, item }: { kind: string; item: HistoryItemBase }) =>
  ordered(item)
    ? `order:${item.historyOrder}`
    : `${kind}:${item.role ?? ""}:${item.runId ?? ""}:${item.id ?? item.toolCallId ?? ""}`;

/** 从当前会话快照提取消息与工具历史记录 */
export function snapshotRecords(session: {
  messages?: TimelineMessage[];
  tools?: TimelineTool[];
}): HistoryRecord[] {
  return [
    ...(session.messages ?? []).map((item) => ({
      kind: "message" as const,
      item,
    })),
    ...(session.tools ?? []).map((item) => ({
      kind: "tool" as const,
      item,
    })),
  ];
}

/** 合并分页历史与实时快照记录，按历史序号或活动序号排序 */
export function mergeHistory(
  previous: HistoryRecord[],
  incoming: HistoryRecord[],
): HistoryRecord[] {
  const records = new Map(
    previous.map((record) => [identity(record), record]),
  );
  let changed = false;

  for (const record of incoming) {
    if (
      !["message", "tool"].includes(record?.kind) ||
      !record.item ||
      typeof record.item !== "object"
    ) {
      continue;
    }
    const key = identity(record);
    const old = records.get(key);
    if (
      old &&
      ((old.item.historyRevision as number | undefined) ?? 0) >
        ((record.item.historyRevision as number | undefined) ?? 0)
    ) {
      continue;
    }
    if (old?.item === record.item) {
      continue;
    }
    records.set(key, record);
    changed = true;
  }

  return changed
    ? [...records.values()].sort(
        (a, b) =>
          ((a.item.historyOrder as number | undefined) ??
            a.item.activityOrder ??
            0) -
          ((b.item.historyOrder as number | undefined) ??
            b.item.activityOrder ??
            0),
      )
    : previous;
}

/** 计算已加载历史记录的起止序号及连续性 */
export function historyBounds(records: HistoryRecord[]): {
  first: number | undefined;
  last: number | undefined;
  continuous: boolean;
} {
  const orders = records
    .filter((record) => ordered(record.item))
    .map((record) => record.item.historyOrder as number)
    .sort((a, b) => a - b);
  return {
    first: orders[0],
    last: orders.at(-1),
    continuous: orders.every(
      (order, index) => !index || order === (orders[index - 1] ?? 0) + 1,
    ),
  };
}

/** 捕获当前滚动视口顶部可见记录的锚点，避免加载更早记录后视口跳动 */
export function captureHistoryAnchor(
  root: HTMLElement | null,
): HistoryAnchor | null {
  if (!root) {
    return null;
  }
  const top = root.getBoundingClientRect().top;
  const node = [...root.querySelectorAll<HTMLElement>("[data-history-order]")].find(
    (item) =>
      item.getClientRects().length > 0 &&
      item.getBoundingClientRect().bottom > top,
  );
  if (node) {
    return {
      order: node.dataset.historyOrder,
      offset: node.getBoundingClientRect().top - top,
    };
  }
  const turn = [...root.querySelectorAll<HTMLElement>("[data-turn-id]")].find(
    (item) => item.getBoundingClientRect().bottom > top,
  );
  return turn
    ? {
        turn: turn.dataset.turnId,
        offset: turn.getBoundingClientRect().top - top,
      }
    : null;
}

/** 根据此前捕获的锚点恢复滚动条位置 */
export function restoreHistoryAnchor(
  root: HTMLElement | null,
  anchor: HistoryAnchor | null,
): void {
  if (!root || !anchor) {
    return;
  }
  const node = [
    ...root.querySelectorAll<HTMLElement>(
      anchor.order ? "[data-history-order]" : "[data-turn-id]",
    ),
  ].find((item) =>
    anchor.order
      ? item.dataset.historyOrder === anchor.order
      : item.dataset.turnId === anchor.turn,
  );
  if (node) {
    root.scrollTop +=
      node.getBoundingClientRect().top -
      root.getBoundingClientRect().top -
      anchor.offset;
  }
}
