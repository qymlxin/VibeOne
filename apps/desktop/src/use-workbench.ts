import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PluginLifecycleAction,
  SnapshotResponse,
  JsonValue,
} from "@vibeone/client-contracts";
import {
  connectHost,
  request,
  restartHost,
  type HostConnection,
} from "./api.ts";
import {
  invokePluginOperation,
  managePluginLifecycle,
} from "./plugin-operations.ts";
import {
  createWorkbenchSync,
  type SyncDiagnostics,
} from "./workbench-sync.ts";

export type WorkbenchPhase =
  | "connecting"
  | "online"
  | "reconnecting"
  | "offline"
  | "upgrading";

// 渲染进程内部使用的宽松快照形状，兼容旧版或增量扩展字段
export interface WorkbenchSnapshotState extends Partial<SnapshotResponse> {
  providers: NonNullable<SnapshotResponse["providers"]>;
  sessions: NonNullable<SnapshotResponse["sessions"]>;
  syncDiagnostics?: SyncDiagnostics;
}

export interface WorkbenchConnectionState extends HostConnection {
  migrationPending?: boolean;
  migrationWarning?: string;
}

export interface WorkbenchController extends WorkbenchSnapshotState {
  dataDirectory?: string;
  migrationPending: boolean;
  migrationWarning?: string;
  phase: WorkbenchPhase;
  error: string;
  call<T = unknown>(path: string, body?: unknown): Promise<T>;
  read<T = unknown>(path: string, signal?: AbortSignal): Promise<T>;
  invokePlugin(id: string, body: Record<string, unknown>): Promise<unknown>;
  managePlugin(
    action: PluginLifecycleAction,
    input: JsonValue & { id?: string },
  ): Promise<unknown>;
  reconnect(): Promise<void>;
  restart(): Promise<void>;
}

/** 维护工作主机连接、WebSocket 事件流与增量同步投影的核心 Hook */
export function useWorkbench(): WorkbenchController {
  const [connection, setConnection] = useState<WorkbenchConnectionState | null>(
    null,
  );
  const [snapshot, setSnapshot] = useState<WorkbenchSnapshotState>({
    providers: [],
    sessions: [],
  });
  const [phase, setPhase] = useState<WorkbenchPhase>("connecting");
  const [error, setError] = useState("");
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const upgrading = useRef(false);

  const reconnect = useCallback(async () => {
    setPhase("connecting");
    setError("");
    try {
      setConnection(await connectHost());
    } catch (err) {
      setError(String(err));
      setPhase("offline");
    }
  }, []);

  const restart = useCallback(async () => {
    upgrading.current = true;
    setPhase("upgrading");
    setError("");
    setConnection(null);
    try {
      setConnection(await restartHost());
    } catch (err) {
      setError(String(err));
      setPhase("offline");
    } finally {
      upgrading.current = false;
    }
  }, []);

  useEffect(() => {
    void reconnect();
  }, [reconnect]);

  useEffect(() => {
    if (!connection) {
      return;
    }
    let closed = false;
    let socket: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let debounce: ReturnType<typeof setTimeout> | null | undefined;
    const controller = new AbortController();
    const sync = createWorkbenchSync(
      (path) => request(connection, path, undefined, controller.signal),
      setSnapshot,
    );
    const refresh = async () => {
      try {
        await sync.refresh();
      } catch (err) {
        if (!closed && !upgrading.current) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    };

    // 新连接拥有独立 revision 空间，重置旧投影
    setSnapshot({ providers: [], sessions: [] });
    refreshRef.current = refresh;

    const open = () => {
      socket = new WebSocket(
        `${connection.url.replace(/^http/, "ws")}/v1/events`,
      );
      socket.onopen = () =>
        socket?.send(JSON.stringify({ token: connection.token }));
      socket.onmessage = (event) => {
        if (closed || upgrading.current) {
          return;
        }
        let message: { type?: string };
        try {
          message = JSON.parse(String(event.data)) as { type?: string };
        } catch {
          socket?.close();
          return;
        }
        if (message.type === "ready") {
          setPhase("online");
          setError("");
          void refresh();
        } else if (!debounce) {
          debounce = setTimeout(() => {
            debounce = null;
            void refresh();
          }, 60);
        }
      };
      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        if (!closed && !upgrading.current) {
          setPhase("reconnecting");
          void refresh();
          retry = setTimeout(open, 1500);
        }
      };
    };

    open();
    return () => {
      closed = true;
      if (retry) {
        clearTimeout(retry);
      }
      if (debounce) {
        clearTimeout(debounce);
      }
      sync.close();
      controller.abort();
      socket?.close();
    };
  }, [connection]);

  const call = useCallback(
    async <T = unknown,>(path: string, body?: unknown): Promise<T> => {
      if (!connection || phase !== "online") {
        throw new Error("主机未连接，请先重新连接");
      }
      const result = await request<T>(connection, path, body);
      await refreshRef.current();
      return result;
    },
    [connection, phase],
  );

  const read = useCallback(
    async <T = unknown,>(path: string, signal?: AbortSignal): Promise<T> => {
      if (!connection || phase !== "online") {
        throw new Error("主机未连接");
      }
      return request<T>(connection, path, undefined, signal);
    },
    [connection, phase],
  );

  const hasPluginOperations = Boolean(
    snapshot.features?.includes("pluginOperations"),
  );
  const invokePlugin = useCallback(
    (id: string, body: Record<string, unknown>) => {
      if (!hasPluginOperations) {
        return call(`/plugins/${id}/invoke`, body);
      }
      return invokePluginOperation(
        {
          submit: (pluginId, payload) =>
            call(`/plugins/${pluginId}/operations`, payload),
          read: (operationId) => read(`/operations/${operationId}`),
          refresh: () => refreshRef.current(),
        },
        id,
        body,
      );
    },
    [call, read, hasPluginOperations],
  );

  const hasPluginLifecycle = Boolean(
    snapshot.features?.includes("pluginLifecycleOperations"),
  );
  const managePlugin = useCallback(
    (action: PluginLifecycleAction, input: JsonValue & { id?: string }) =>
      managePluginLifecycle(
        { call, read, refresh: () => refreshRef.current() },
        hasPluginLifecycle,
        action,
        input,
      ),
    [call, read, hasPluginLifecycle],
  );

  return {
    ...snapshot,
    dataDirectory: connection?.dataDirectory,
    migrationPending: Boolean(connection?.migrationPending),
    migrationWarning: connection?.migrationWarning,
    phase,
    error,
    call,
    read,
    invokePlugin,
    managePlugin,
    reconnect,
    restart,
  };
}
