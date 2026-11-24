import { useRef } from "react";
import { cancelSession } from "@vibeone/client-contracts";
import type { TimelineRun } from "./chat-timeline.ts";

/** 查找当前仍在运行且尚未结束的最新 Run */
export const activeRunForStop = (session: { runs?: TimelineRun[] }) =>
  session.runs?.findLast(
    (run) =>
      run.finishedAt == null &&
      ["starting", "running", "requires_action", "cancelling"].includes(
        run.status,
      ),
  );

/** 提供幂等停止当前执行轮次的 Hook */
export function useStopCommand(
  workbench: {
    features?: string[];
    call(path: string, body?: unknown): Promise<unknown>;
  },
  session: { id: string; runs?: TimelineRun[] },
) {
  const intent = useRef<{ runId: string; key: string } | null>(null);
  return async () => {
    if (!workbench.features?.includes("stopCommandIdempotency")) {
      return workbench.call(...cancelSession(session.id));
    }
    const run = activeRunForStop(session);
    if (!run) {
      throw new Error("当前执行身份尚未同步，请稍后重试。");
    }
    let current = intent.current;
    if (current?.runId !== run.id) {
      current = { runId: run.id, key: crypto.randomUUID() };
      intent.current = current;
    }
    // 在整次 Run 生命周期内复用同一幂等键
    return workbench.call(...cancelSession(session.id, current.key, run.id));
  };
}
