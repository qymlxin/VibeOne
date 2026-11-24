import React, { useState } from "react";
import { ChevronDown } from "lucide-react";
import { configureAgent } from "@vibeone/client-contracts";
import {
  canConfigure,
  configChoices,
  type AgentConfigOptionInput,
} from "./agent-config.ts";
import type { DesktopSession, WorkbenchLike } from "./types.ts";

interface ConfigOptionWithValue extends AgentConfigOptionInput {
  configId: string;
  currentValue?: string | boolean;
}

export function AgentConfigControls({
  session,
  workbench,
  compact = false,
  onOpen,
  label,
}: {
  session: DesktopSession;
  workbench: Pick<WorkbenchLike, "phase" | "device" | "call">;
  compact?: boolean;
  onOpen?: () => void;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const options = (session.agentState?.configOptions ??
    []) as ConfigOptionWithValue[];
  const known = options.filter(
    (option) =>
      option.type === "boolean" || configChoices(option).length > 0,
  );
  const disabled = busy || !canConfigure(session, workbench);

  async function change(
    option: ConfigOptionWithValue,
    value: string | boolean,
  ) {
    if (disabled) {
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await workbench.call(
        ...configureAgent(session.id, option.configId, value),
      );
      setNotice(`已应用${option.name ?? option.configId}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  const controls = (
    <>
      <div className="desktop-agent-config-fields">
        {known.map((option) => (
          <label key={option.configId} title={option.description ?? option.name}>
            <span>{option.name ?? option.configId}</span>
            {option.type === "boolean" ? (
              <input
                type="checkbox"
                aria-label={`${compact ? "输入区" : "Agent"}配置：${option.name ?? option.configId}`}
                checked={option.currentValue === true}
                disabled={disabled}
                onChange={(event) => void change(option, event.target.checked)}
              />
            ) : (
              <select
                aria-label={`${compact ? "输入区" : "Agent"}配置：${option.name ?? option.configId}`}
                value={
                  typeof option.currentValue === "string"
                    ? option.currentValue
                    : ""
                }
                disabled={disabled}
                onChange={(event) => void change(option, event.target.value)}
              >
                {!configChoices(option).some(
                  (item) => item.value === option.currentValue,
                ) && (
                  <option
                    disabled
                    value={
                      typeof option.currentValue === "string"
                        ? option.currentValue
                        : ""
                    }
                  >
                    {option.currentValue ?? "请选择"}
                  </option>
                )}
                {configChoices(option).map((item) => (
                  <option
                    key={`${item.group ?? ""}:${item.value}`}
                    value={item.value}
                    title={item.description}
                  >
                    {item.group ? `${item.group} · ` : ""}
                    {item.name ?? item.value}
                  </option>
                ))}
              </select>
            )}
          </label>
        ))}
      </div>
      {!known.length && (
        <p>Agent 尚未提供可配置选项。发送首条消息后会连接并读取能力。</p>
      )}
      {!canConfigure(session, workbench) && known.length > 0 && (
        <p>请在会话可操作、执行与队列结束后修改配置。</p>
      )}
      {busy && <p role="status">正在应用配置…</p>}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!compact &&
        options
          .filter((option) => !known.includes(option))
          .map((option) => (
            <details key={option.configId}>
              <summary>
                {option.name ?? option.configId} · 暂不支持此配置类型
              </summary>
              <pre>{JSON.stringify(option, null, 2)}</pre>
            </details>
          ))}
    </>
  );

  return compact ? (
    <details className="desktop-agent-config compact">
      <summary className="model" aria-label="模型与模式">
        {label ?? "模型与模式"}
        <ChevronDown size={12} />
      </summary>
      {controls}
      {onOpen && (
        <button type="button" onClick={onOpen}>
          查看 Agent 完整配置
        </button>
      )}
    </details>
  ) : (
    <section className="desktop-agent-config" aria-label="Agent 会话配置">
      {controls}
    </section>
  );
}
