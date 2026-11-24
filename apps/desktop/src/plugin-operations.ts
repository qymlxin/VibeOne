import {
  pluginLifecycleOperation,
  type JsonValue,
  type PluginLifecycleAction,
  type PluginOperationReceipt,
  type PluginOperationRecord,
  type PluginOperationSummary,
} from "@vibeone/client-contracts";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface PluginOperationTransport {
  submit(
    plugin: string,
    body: Record<string, unknown> & { key: string },
  ): Promise<PluginOperationReceipt>;
  read(operationId: string): Promise<PluginOperationRecord>;
  refresh(): Promise<unknown>;
}

export interface PluginLifecycleTransport {
  call(path: string, body?: unknown): Promise<unknown>;
  read(path: string): Promise<unknown>;
  refresh(): Promise<unknown>;
}

export interface InvokePluginOperationOptions {
  key?: string;
  pause?: (ms: number) => Promise<void>;
}

/** 提交异步插件操作并轮询直到终态 */
export async function invokePluginOperation(
  transport: PluginOperationTransport,
  plugin: string,
  body: Record<string, unknown>,
  { key = crypto.randomUUID(), pause = sleep }: InvokePluginOperationOptions = {},
): Promise<JsonValue | undefined> {
  let receipt: PluginOperationReceipt;
  try {
    receipt = await transport.submit(plugin, { ...body, key });
  } catch (cause) {
    const err = cause as { status?: number };
    if (typeof err?.status === "number" && err.status >= 400 && err.status < 500) {
      throw cause;
    }
    throw Object.assign(
      new Error("提交结果尚未确认，请查看最近后台操作，避免重复执行。"),
      { cause, operationKey: key },
    );
  }

  if (!receipt?.operationId) {
    throw new Error("主机没有返回操作回执，请刷新后查看最近后台操作。");
  }

  for (;;) {
    let record: PluginOperationRecord;
    try {
      record = await transport.read(receipt.operationId);
    } catch (cause) {
      throw Object.assign(
        new Error("操作已受理，连接恢复后可在最近后台操作中查看结果。"),
        { cause, operationId: receipt.operationId },
      );
    }
    if (record.state === "succeeded") {
      await transport.refresh();
      return record.result;
    }
    if (["failed", "interrupted"].includes(record.state)) {
      await transport.refresh();
      throw Object.assign(new Error(record.error?.message ?? "插件操作未完成"), {
        code: record.error?.code,
        operationId: receipt.operationId,
      });
    }
    if (!["accepted", "running"].includes(record.state)) {
      throw Object.assign(
        new Error("无法识别操作状态，请在最近后台操作中核对。"),
        { operationId: receipt.operationId },
      );
    }
    await pause(250);
  }
}

const operationStates: Record<string, string> = {
  accepted: "已受理",
  running: "执行中",
  succeeded: "已完成",
  failed: "失败",
  interrupted: "已中断",
};

/** 生成插件后台操作的展示文案 */
export function operationPresentation(
  operation: Partial<PluginOperationSummary> & { state: string },
): { title: string; plugin: string; time: string; state: string } {
  const date =
    typeof operation.createdAt === "number"
      ? new Date(operation.createdAt)
      : null;
  return {
    title: operation.title || operation.handler || "未知操作",
    plugin:
      operation.pluginName ||
      operation.pluginId ||
      (operation.kind === "plugin.lifecycle" ? "本机插件管理" : "未知插件"),
    time:
      date && !Number.isNaN(date.getTime())
        ? date.toLocaleString()
        : "时间未知",
    state:
      operation.error?.code === "OPERATION_RECORD_INVALID"
        ? "记录异常"
        : Object.hasOwn(operationStates, operation.state)
          ? (operationStates[operation.state] ?? "未知状态")
          : "未知状态",
  };
}

/** 统一调度插件生命周期操作（兼容旧版同步端点与新版异步操作回执） */
export function managePluginLifecycle(
  transport: PluginLifecycleTransport,
  enabled: boolean,
  action: PluginLifecycleAction,
  input: JsonValue & { id?: string },
  options?: InvokePluginOperationOptions,
): Promise<unknown> {
  if (!enabled) {
    if (["inspect", "prepare", "commit", "discard"].includes(action)) {
      return transport.call(`/plugins/${action}`, input);
    }
    if (action === "disable") {
      const id =
        input && typeof input === "object" && !Array.isArray(input)
          ? String(input.id ?? "")
          : "";
      return transport.call(`/plugins/${encodeURIComponent(id)}/disable`, {});
    }
    throw new Error("无法识别插件管理动作");
  }
  return invokePluginOperation(
    {
      submit: (act, body) =>
        transport.call(
          ...pluginLifecycleOperation(
            act as PluginLifecycleAction,
            body.input as JsonValue,
            body.key,
          ),
        ) as Promise<PluginOperationReceipt>,
      read: (id) =>
        transport.read(
          `/operations/${encodeURIComponent(id)}`,
        ) as Promise<PluginOperationRecord>,
      refresh: transport.refresh,
    },
    action,
    { input },
    options,
  );
}
