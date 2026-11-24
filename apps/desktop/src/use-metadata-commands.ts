import { useRef, useState } from "react";
import {
  updateSession,
  type UpdateSessionRequest,
} from "@vibeone/client-contracts";

/** 会话元数据修改（重命名/归档）幂等命令 Hook */
export function useMetadataCommands(
  workbench: {
    features?: string[];
    call(path: string, body?: unknown): Promise<unknown>;
  },
  sessionId: string,
) {
  const intent = useRef<{
    signature: string;
    body: UpdateSessionRequest;
    key: string;
  } | null>(null);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{
    body: UpdateSessionRequest;
    message: string;
  } | null>(null);

  const execute = async (body: UpdateSessionRequest): Promise<boolean> => {
    if (pending.current) {
      return false;
    }
    const signature = JSON.stringify(body);
    if (intent.current && intent.current.signature !== signature) {
      return false;
    }
    if (!intent.current) {
      intent.current = { signature, body, key: crypto.randomUUID() };
    }
    const current = intent.current;
    pending.current = true;
    setBusy(true);
    setFailure(null);
    try {
      await workbench.call(
        ...updateSession(sessionId, {
          ...current.body,
          ...(workbench.features?.includes("metadataCommandIdempotency")
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
            ? "连接失败，会话修改结果尚未确认。"
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
      if (pending.current) {
        return;
      }
      intent.current = null;
      setFailure(null);
    },
  };
}
