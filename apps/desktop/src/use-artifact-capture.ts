import { useRef, useState } from "react";
import {
  captureArtifact,
  type ArtifactRecord,
} from "@vibeone/client-contracts";

/** 捕获工作区文本文件为会话产物的幂等操作 Hook */
export function useArtifactCapture(
  workbench: {
    features?: string[];
    call<T = unknown>(path: string, body?: unknown): Promise<T>;
  },
  sessionId: string,
) {
  const intent = useRef<{ path: string; key: string } | null>(null);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{
    path: string;
    message: string;
  } | null>(null);
  const [notice, setNotice] = useState("");

  const save = async (path: string): Promise<ArtifactRecord | null> => {
    if (pending.current || (intent.current && intent.current.path !== path)) {
      return null;
    }
    if (intent.current?.path !== path) {
      intent.current = { path, key: crypto.randomUUID() };
    }
    const current = intent.current;
    pending.current = true;
    setBusy(true);
    setFailure(null);
    setNotice("");
    try {
      const record = await workbench.call<ArtifactRecord>(
        ...captureArtifact(
          sessionId,
          path,
          workbench.features?.includes("artifactCaptureIdempotency")
            ? current.key
            : undefined,
        ),
      );
      intent.current = null;
      setNotice(
        `已保存文本产物：${record.path}${record.content?.truncated ? "（内容已截断）" : ""}`,
      );
      return record;
    } catch (error) {
      setFailure({
        path: current.path,
        message:
          error instanceof TypeError
            ? "连接失败，保存结果尚未确认。"
            : error instanceof Error
              ? error.message
              : String(error),
      });
      return null;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  return {
    save,
    busy,
    failure,
    notice,
    retry: () => (failure ? save(failure.path) : Promise.resolve(null)),
    dismiss: () => {
      intent.current = null;
      setFailure(null);
    },
  };
}
