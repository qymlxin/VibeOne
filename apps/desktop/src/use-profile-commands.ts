import { useRef } from "react";
import type { Command } from "@vibeone/client-contracts";

/** 保留配置变更请求幂等键的 Hook（不自动重放未知结果） */
export function useProfileCommands(workbench: {
  features?: string[];
  call<T = unknown>(path: string, body?: unknown): Promise<T>;
}) {
  const intent = useRef<{ signature: string; key: string } | null>(null);
  return {
    reset() {
      intent.current = null;
    },
    async call<TBody extends Record<string, unknown>>([
      path,
      body,
    ]: Command<TBody>) {
      if (!workbench.features?.includes("profileCommandIdempotency")) {
        return workbench.call(path, body);
      }
      const signature = JSON.stringify(body);
      if (intent.current?.signature !== signature) {
        intent.current = { signature, key: crypto.randomUUID() };
      }
      const current = intent.current;
      const result = await workbench.call(path, { ...body, key: current.key });
      if (intent.current === current) {
        intent.current = null;
      }
      return result;
    },
  };
}
