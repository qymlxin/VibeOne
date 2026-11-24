import {
  describeAction,
  describeTool,
  type ToolRecordInput,
} from "./tool-presentation.ts";

export interface TimelineMessage {
  id: string;
  role: string;
  text: string;
  runId?: string | null;
  activityOrder?: number;
  historyOrder?: number;
  textTruncated?: boolean;
  [key: string]: unknown;
}

export interface TimelineTool extends ToolRecordInput {
  toolCallId: string;
  runId?: string | null;
  activityOrder?: number;
  historyOrder?: number;
  [key: string]: unknown;
}

export interface TimelineRun {
  id: string;
  status: string;
  text?: string;
  error?: string | null;
  files?: string[];
  createdAt?: number | null;
  startedAt?: number | null;
  finishedAt?: number | null;
  [key: string]: unknown;
}

export interface TimelineActivityEvent {
  id: string;
  type: "thought" | "tool" | "note";
  text?: string;
  item: TimelineMessage | TimelineTool;
  unknownRole?: boolean;
}

export type ProcessGroupItem =
  | {
      id: string;
      type: "thought" | "note";
      event: TimelineActivityEvent;
    }
  | {
      id: string;
      type: "tools";
      family: "read" | "web" | "command" | "file" | "other";
      items: TimelineActivityEvent[];
    };

export interface TimelineTurn {
  id: string;
  user: TimelineMessage | null;
  replies: TimelineMessage[];
  activity: TimelineActivityEvent[];
  run?: TimelineRun;
  live?: boolean;
  answer: TimelineMessage | null;
  process: TimelineActivityEvent[];
}

export const isRunActive = (status: string): boolean =>
  ["starting", "running", "requires_action", "cancelling"].includes(status);

/** 将会话消息与工具记录按持久化的 Run 身份分组为对话轮次 */
export function buildTurns(session: {
  messages: TimelineMessage[];
  tools: TimelineTool[];
  runs?: TimelineRun[];
  status: string;
}): TimelineTurn[] {
  const turns: TimelineTurn[] = [];
  const byId = new Map<string, TimelineTurn>();
  const add = (id: string): TimelineTurn => {
    const turn: TimelineTurn = {
      id,
      user: null,
      replies: [],
      activity: [],
      run: (session.runs ?? []).find((run) => run.id === id),
      answer: null,
      process: [],
    };
    turns.push(turn);
    byId.set(id, turn);
    return turn;
  };

  const messagePositions = new Map<TimelineMessage | TimelineTool, number>(
    session.messages.map((message, index) => [message, index + 1]),
  );
  let current: TimelineTurn | undefined;

  for (const message of session.messages) {
    if (message.role === "user") {
      current =
        (message.runId ? byId.get(message.runId) : undefined) ??
        add(message.runId ?? `user:${message.id}`);
      current.user =
        typeof current.run?.text === "string"
          ? { ...message, text: current.run.text, textTruncated: false }
          : message;
    } else {
      const knownRole =
        message.role === "thought" || message.role === "assistant";
      let turn = message.runId ? byId.get(message.runId) : undefined;
      if (!turn) {
        if (message.runId) {
          turn = add(message.runId);
        } else if (knownRole && current) {
          turn = current;
        } else {
          turn = byId.get("legacy-messages") ?? add("legacy-messages");
        }
      }
      current = turn;
      if (message.role === "thought") {
        turn.activity.push({
          id: `thought:${message.id}`,
          type: "thought",
          text: message.text,
          item: message,
        });
      } else if (message.role === "assistant") {
        turn.replies.push(message);
      } else {
        turn.activity.push({
          id: `unknown:${message.id}`,
          type: "note",
          text: message.text,
          item: message,
          unknownRole: true,
        });
      }
    }
  }

  for (const tool of session.tools) {
    const turn = tool.runId
      ? (byId.get(tool.runId) ?? add(tool.runId))
      : (byId.get("legacy-tools") ?? add("legacy-tools"));
    turn.activity.push({
      id: `tool:${tool.toolCallId}`,
      type: "tool",
      text: tool.title ?? tool.name ?? "工具调用",
      item: tool,
    });
  }

  const activeRun = (session.runs ?? []).findLast((run) =>
    isRunActive(run.status),
  );
  if (isRunActive(session.status) && !turns.length) {
    add(activeRun?.id ?? "pending");
  }

  for (const turn of turns) {
    turn.activity.sort(
      (a, b) => (a.item.activityOrder ?? 0) - (b.item.activityOrder ?? 0),
    );
    turn.live =
      isRunActive(session.status) &&
      (activeRun ? turn.id === activeRun.id : turn === turns.at(-1));

    // 按首次观测顺序排序，避免已完成的后台事件跳到后续正文之前
    const events: Array<
      | {
          kind: "activity";
          activity: TimelineActivityEvent;
          message?: undefined;
          order: number;
        }
      | {
          kind: "message";
          message: TimelineMessage;
          activity?: undefined;
          order: number;
        }
    > = [
      ...turn.activity.map((activity) => ({
        kind: "activity" as const,
        activity,
        order:
          activity.item.activityOrder ??
          messagePositions.get(activity.item) ??
          0,
      })),
      ...turn.replies.map((message) => ({
        kind: "message" as const,
        message,
        order: message.activityOrder ?? messagePositions.get(message) ?? 0,
      })),
    ].sort((a, b) => a.order - b.order);

    const lastReply = turn.replies.at(-1);
    const replyOrder =
      (lastReply
        ? (lastReply.activityOrder ?? messagePositions.get(lastReply))
        : undefined) ?? -1;
    const activityAfterReply = events.some(
      (event) => event.kind === "activity" && event.order > replyOrder,
    );
    turn.answer = lastReply && !activityAfterReply ? lastReply : null;
    turn.process = events
      .filter((event) => event.message !== turn.answer)
      .map((event) =>
        event.kind === "message"
          ? {
              id: `note:${event.message.id}`,
              type: "note" as const,
              text: event.message.text,
              item: event.message,
            }
          : event.activity,
      );
  }

  return turns.sort((a, b) => {
    const first = (turn: TimelineTurn) =>
      [
        turn.user,
        ...turn.replies,
        ...turn.activity.map((event) => event.item),
      ].reduce(
        (order, item) => Math.min(order, item?.historyOrder ?? Infinity),
        Infinity,
      );
    return first(a) - first(b);
  });
}

/** 截取活动文本最后一个非空行用于紧凑预览 */
export function activityTail(text: unknown, limit = 150): string {
  const line =
    String(text ?? "")
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean)
      .at(-1) ?? "";
  return line.length > limit ? `…${line.slice(-limit)}` : line;
}

/** 根据工具语义归纳所属类别 */
export function toolFamily(
  tool: TimelineTool,
): "read" | "web" | "command" | "file" | "other" {
  if (describeAction(tool).operation === "read") {
    return "read";
  }
  const kind = describeTool(tool).kind;
  if (
    kind === "search" ||
    kind === "web" ||
    ["search", "fetch"].includes(tool.kind ?? "")
  ) {
    return "web";
  }
  if (kind === "command" || tool.kind === "execute") {
    return "command";
  }
  if (
    kind === "file" ||
    ["read", "edit", "delete", "move"].includes(tool.kind ?? "")
  ) {
    return "file";
  }
  return "other";
}

/** 将连续的同类工具调用折叠成过程组 */
export function groupProcess(
  events: TimelineActivityEvent[],
): ProcessGroupItem[] {
  const groups: ProcessGroupItem[] = [];
  for (const event of events) {
    const last = groups.at(-1);
    if (event.type !== "tool") {
      groups.push({ id: event.id, type: event.type, event });
      continue;
    }
    const family = toolFamily(event.item as TimelineTool);
    if (last?.type === "tools" && last.family === family) {
      last.items.push(event);
    } else {
      groups.push({
        id: `tools:${event.id}`,
        type: "tools",
        family,
        items: [event],
      });
    }
  }
  return groups;
}

/** 格式化耗时秒数为可读中文 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds} 秒`;
  }
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes} 分 ${remaining} 秒`;
}
