import { useRef, useState } from "react";
import {
  controlQueue,
  type QueueRequest,
} from "@vibeone/client-contracts";

/** 会话队列控制（暂停/继续/撤回/新上下文）幂等命令 Hook */
export function useQueueCommands(
  workbench: {
    features?: string[];
    call(path: string, body?: unknown): Promise<unknown>;
  },
  sessionId: string,
) {
  const intent = useRef<{
    signature: string;
    body: QueueRequest;
    key: string;
  } | null>(null);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{
    body: QueueRequest;
    message: string;
  } | null>(null);

  const execute = async (body: QueueRequest): Promise<boolean> => {
    if (pending.current) {
      return false;
    }
    const signature = JSON.stringify(body);
    if (intent.current?.signature !== signature) {
      intent.current = { signature, body, key: crypto.randomUUID() };
    }
    const current = intent.current;
    pending.current = true;
    setBusy(true);
    setFailure(null);
    try {
      await workbench.call(
        ...controlQueue(sessionId, {
          ...body,
          ...(workbench.features?.includes("queueCommandIdempotency")
            ? { key: current.key }
            : {}),
        }),
      );
      intent.current = null;
      return true;
    } catch (error) {
      setFailure({
        body: current.body,
        message:
          error instanceof TypeError
            ? "连接失败，队列操作结果尚未确认。"
            : error instanceof Error
              ? error.message
              : String(error),
      });
      return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  return {
    execute,
    busy,
    failure,
    retry: () =>
      failure ? execute(failure.body) : Promise.resolve(false),
    dismiss: () => {
      intent.current = null;
      setFailure(null);
    },
  };
}
