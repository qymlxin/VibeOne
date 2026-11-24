import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TimelineMessage, TimelineRun, TimelineTool } from "./chat-timeline.ts";
import {
  historyBounds,
  mergeHistory,
  snapshotRecords,
  type HistoryRecord,
} from "./conversation-history.ts";

interface HistoryPageResponse {
  records: HistoryRecord[];
  hasMore: boolean;
  nextBefore?: number;
  warnings?: string[];
}

interface HistoryStatus {
  ready: boolean;
  busy: boolean;
  error: string;
  hasMore: boolean;
  nextBefore?: number;
  warnings: string[];
}

/** 增量同步与分页加载完整会话历史记录的 Hook */
export function useConversationHistory<
  TSession extends {
    id: string;
    messages: TimelineMessage[];
    tools: TimelineTool[];
    runs?: TimelineRun[];
    historySequence?: number;
  },
>({
  session,
  workbench,
  online,
  onBeforeMerge,
}: {
  session: TSession;
  workbench: {
    features?: string[];
    read<T = unknown>(path: string, signal?: AbortSignal): Promise<T>;
  };
  online: boolean;
  onBeforeMerge?: () => void;
}) {
  const enabled = Boolean(workbench.features?.includes("conversationHistory"));
  const initial = snapshotRecords(session);
  const cache = useRef(initial);
  const latest = useRef(initial);
  const beforeMerge = useRef(onBeforeMerge);
  latest.current = initial;
  beforeMerge.current = onBeforeMerge;

  const [records, setRecords] = useState(initial);
  const [status, setStatus] = useState<HistoryStatus>({
    ready: false,
    busy: false,
    error: "",
    hasMore: false,
    warnings: [],
  });

  const finishedRun =
    session.runs?.findLast((run) => Boolean(run.finishedAt))?.id ?? null;
  const pendingSync = useRef(false);
  const previousFinished = useRef(finishedRun);
  const statusRef = useRef(status);
  const flight = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const [retry, setRetry] = useState(0);
  statusRef.current = status;

  const publish = useCallback((incoming: HistoryRecord[]) => {
    const merged = mergeHistory(
      mergeHistory(cache.current, incoming),
      latest.current,
    );
    if (merged !== cache.current) {
      beforeMerge.current?.();
      cache.current = merged;
      setRecords(merged);
    }
  }, []);

  useEffect(
    () => publish(initial),
    [session.messages, session.tools, publish],
  );

  const fetchPages = useCallback(
    async (older = false) => {
      if (!enabled || !online || flight.current) {
        return;
      }
      pendingSync.current = false;
      const controller = new AbortController();
      const epoch = generation.current;
      flight.current = controller;
      const start = historyBounds(mergeHistory(cache.current, latest.current));
      const target = start.first;
      let before = older ? statusRef.current.nextBefore : undefined;
      if (older && !before) {
        flight.current = null;
        return;
      }
      setStatus((previous) => ({ ...previous, busy: true, error: "" }));
      let succeeded = false;
      try {
        let page: HistoryPageResponse;
        const collected: HistoryRecord[] = [];
        do {
          const limit =
            !older && target && before
              ? Math.max(1, Math.min(128, before - target))
              : 128;
          page = await workbench.read<HistoryPageResponse>(
            `/sessions/${session.id}/history?limit=${limit}${before ? `&before=${before}` : ""}`,
            controller.signal,
          );
          if (controller.signal.aborted || epoch !== generation.current) {
            return;
          }
          collected.push(...page.records);
          if (
            !page.hasMore ||
            older ||
            !target ||
            (page.nextBefore !== undefined && page.nextBefore <= target)
          ) {
            break;
          }
          if (!page.nextBefore || (before && page.nextBefore >= before)) {
            throw new Error("历史分页游标没有前进，请重试");
          }
          before = page.nextBefore;
        } while (true);

        succeeded = true;
        publish(collected);
        setStatus({
          ready: true,
          busy: false,
          error: "",
          hasMore: page.hasMore,
          nextBefore: page.nextBefore,
          warnings: page.warnings ?? [],
        });
      } catch (error) {
        if (!controller.signal.aborted && epoch === generation.current) {
          setStatus((previous) => ({
            ...previous,
            busy: false,
            error: error instanceof Error ? error.message : String(error),
          }));
        }
      } finally {
        if (flight.current === controller) {
          flight.current = null;
          if (
            succeeded &&
            (pendingSync.current ||
              older ||
              !historyBounds(mergeHistory(cache.current, latest.current))
                .continuous)
          ) {
            setRetry((value) => value + 1);
          }
        }
      }
    },
    [enabled, online, session.id, workbench.read, publish],
  );

  // 重连时重新同步已加载历史区间，卸载或切换连接时废弃过期响应
  useEffect(() => {
    generation.current++;
    flight.current?.abort();
    flight.current = null;
    setStatus((previous) => ({ ...previous, busy: false }));
    void fetchPages();
    return () => {
      generation.current++;
      flight.current?.abort();
      flight.current = null;
    };
  }, [fetchPages]);

  useEffect(() => {
    const bounds = historyBounds(mergeHistory(cache.current, latest.current));
    if (
      enabled &&
      online &&
      (!statusRef.current.ready || pendingSync.current || !bounds.continuous)
    ) {
      void fetchPages();
    }
  }, [session.historySequence, retry, enabled, online, fetchPages]);

  useEffect(() => {
    if (previousFinished.current !== finishedRun) {
      pendingSync.current = true;
      void fetchPages();
    }
    previousFinished.current = finishedRun;
  }, [finishedRun, fetchPages]);

  const merged = useMemo(
    () => mergeHistory(records, snapshotRecords(session)),
    [records, session.messages, session.tools],
  );
  const view = useMemo(
    () => ({
      ...session,
      messages: merged
        .filter(
          (record): record is { kind: "message"; item: TimelineMessage } =>
            record.kind === "message",
        )
        .map((record) => record.item),
      tools: merged
        .filter(
          (record): record is { kind: "tool"; item: TimelineTool } =>
            record.kind === "tool",
        )
        .map((record) => record.item),
    }),
    [session, merged],
  );

  return {
    session: view,
    ...status,
    enabled,
    loadOlder: () => fetchPages(true),
    retry: () => fetchPages(),
  };
}
