import type { SessionView, SnapshotMetadata, SnapshotResponse } from "@vibeone/client-contracts";

/** 同步协议异常（由调用方触发全量重置或回退到旧版快照） */
export class SyncProtocolError extends Error {}

export interface SyncProjection {
  epoch: string | null;
  cursor: number;
  snapshot: SnapshotResponse;
}

export interface SyncDiagnostics {
  recoveries: number;
  lastReason: string | null;
}

export interface SyncResetFrame {
  version: number;
  epoch: string;
  cursor: number;
  reset: true;
  snapshot: SnapshotResponse;
}

export interface SyncDeltaEvent {
  type: string;
  id: string;
  cursor: number;
  session: SessionView;
}

export interface SyncDeltaFrame {
  version: number;
  epoch: string;
  cursor: number;
  reset?: false;
  from: number;
  metadata: SnapshotMetadata;
  events: SyncDeltaEvent[];
  visibleSessionIds: string[];
}

export type SyncFrame = SyncResetFrame | SyncDeltaFrame;

const integer = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** 根据同步帧增量或全量归约前端工作台投影（仅本地状态归约，不解释 ACP 语义） */
export function applySync(
  current: SyncProjection | null,
  frame: SyncFrame,
): SyncProjection {
  if (
    frame?.version !== 1 ||
    typeof frame.epoch !== "string" ||
    !integer(frame.cursor)
  ) {
    throw new SyncProtocolError("unsupported-envelope");
  }

  if (frame.reset) {
    if (
      !Array.isArray(frame.snapshot?.sessions) ||
      frame.snapshot.revision !== frame.cursor
    ) {
      throw new SyncProtocolError("invalid-snapshot");
    }
    if (current?.epoch === frame.epoch && current.cursor > frame.cursor) {
      return current;
    }
    return {
      epoch: frame.epoch,
      cursor: frame.cursor,
      snapshot: frame.snapshot,
    };
  }

  if (!current || current.epoch !== frame.epoch) {
    throw new SyncProtocolError("epoch-mismatch");
  }
  if (
    frame.cursor < current.cursor ||
    (frame.from < current.cursor && frame.cursor === current.cursor)
  ) {
    return current;
  }
  if (
    frame.from !== current.cursor ||
    frame.cursor < frame.from ||
    frame.metadata?.revision !== frame.cursor ||
    !Array.isArray(frame.events) ||
    !Array.isArray(frame.visibleSessionIds)
  ) {
    throw new SyncProtocolError("cursor-gap");
  }

  const visible = new Set(frame.visibleSessionIds);
  const sessions = new Map(
    current.snapshot.sessions
      .filter((session) => visible.has(session.id))
      .map((session) => [session.id, session]),
  );
  const seen = new Set<string>();
  const versions = new Map<string, number>();

  for (const event of frame.events) {
    if (event.type !== "session.projected") {
      throw new SyncProtocolError("unknown-event");
    }
    if (
      typeof event.id !== "string" ||
      !integer(event.cursor) ||
      event.cursor <= frame.from ||
      event.cursor > frame.cursor ||
      typeof event.session?.id !== "string" ||
      !visible.has(event.session.id)
    ) {
      throw new SyncProtocolError("invalid-event");
    }
    if (seen.has(event.id)) {
      continue;
    }
    seen.add(event.id);
    if (event.cursor > (versions.get(event.session.id) ?? -1)) {
      versions.set(event.session.id, event.cursor);
      sessions.set(event.session.id, event.session);
    }
  }

  if ([...visible].some((id) => !sessions.has(id))) {
    throw new SyncProtocolError("missing-session");
  }

  return {
    epoch: frame.epoch,
    cursor: frame.cursor,
    snapshot: {
      ...frame.metadata,
      sessions: [...sessions.values()].sort((a, b) => a.id.localeCompare(b.id)),
    },
  };
}

/** 创建带请求合并与自动断线恢复的工作台同步泵 */
export function createWorkbenchSync(
  read: (path: string) => Promise<unknown>,
  publish: (
    snapshot: SnapshotResponse & { syncDiagnostics: SyncDiagnostics },
  ) => void,
): { refresh(): Promise<void>; close(): void } {
  let projection: SyncProjection | null = null;
  let legacy = false;
  let closed = false;
  let running = false;
  const waiters: Array<{
    resolve: () => void;
    reject: (error: unknown) => void;
  }> = [];
  const diagnostics: SyncDiagnostics = { recoveries: 0, lastReason: null };

  const accept = (next: SyncProjection) => {
    if (!closed) {
      projection = next;
      publish({ ...next.snapshot, syncDiagnostics: { ...diagnostics } });
    }
  };

  const snapshot = async () => {
    const next = (await read("/snapshot")) as SnapshotResponse;
    if (!projection || next.revision >= projection.cursor) {
      accept({ epoch: null, cursor: next.revision, snapshot: next });
    }
  };

  const update = async () => {
    if (legacy) {
      await snapshot();
      return;
    }
    try {
      const path = projection?.epoch
        ? `/sync?epoch=${encodeURIComponent(projection.epoch)}&after=${projection.cursor}`
        : "/sync";
      const frame = (await read(path)) as SyncFrame;
      if (!closed) {
        accept(applySync(projection, frame));
      }
    } catch (error) {
      if (closed) {
        return;
      }
      const err = error as { status?: number; message?: string };
      if (err.status === 404 || error instanceof SyncProtocolError) {
        diagnostics.recoveries++;
        diagnostics.lastReason =
          err.status === 404 ? "legacy-host" : (err.message ?? "sync-error");
        if (err.status === 404 || err.message === "unsupported-envelope") {
          legacy = true;
          await snapshot();
        } else {
          // 遇到未知事件或游标缺口时丢弃局部状态并请求全量重置帧
          const frame = (await read("/sync")) as SyncFrame;
          if (!frame.reset) {
            throw new SyncProtocolError("missing-reset");
          }
          accept(applySync(null, frame));
        }
      } else {
        throw error;
      }
    }
  };

  const pump = async () => {
    running = true;
    try {
      while (waiters.length && !closed) {
        const batch = waiters.splice(0);
        try {
          await update();
          for (const waiter of batch) {
            waiter.resolve();
          }
        } catch (error) {
          for (const waiter of [...batch, ...waiters.splice(0)]) {
            waiter.reject(error);
          }
        }
      }
    } finally {
      running = false;
    }
  };

  return {
    refresh() {
      if (closed) {
        return Promise.resolve();
      }
      const result = new Promise<void>((resolve, reject) =>
        waiters.push({ resolve, reject }),
      );
      if (!running) {
        void pump();
      }
      return result;
    },
    close() {
      closed = true;
      for (const waiter of waiters.splice(0)) {
        waiter.resolve();
      }
    },
  };
}
