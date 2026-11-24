import React, { useEffect, useRef, useState } from "react";
import {
  probeProvider,
  type ProviderProbeResponse,
} from "@vibeone/client-contracts";
import type { WorkbenchLike } from "./types.ts";
import "./provider-probe.css";

const states: Record<string, string> = {
  ready: "ACP v2 握手通过",
  not_installed: "启动入口或运行依赖未安装",
  incompatible: "协议或会话能力不兼容",
  timed_out: "握手超时，请检查启动程序",
  authentication_required: "桥接器要求先认证",
  failed: "启动或握手失败，请检查安装及启动参数",
};

const authentication: Record<string, string> = {
  authenticated: "CLI 显示已登录",
  not_authenticated: "尚未登录",
  not_required: "演示入口无需登录",
  unknown: "未确认，连接会话时继续验证",
};

interface ProbeResultWithSnakeCase extends ProviderProbeResponse {
  authentication_command?: string | null;
}

export function ProviderProbe({
  workbench,
  provider,
  profileId,
  dirty,
}: {
  workbench: Pick<WorkbenchLike, "features" | "phase" | "call">;
  provider: string;
  profileId?: string;
  dirty: boolean;
}) {
  const [result, setResult] = useState<ProbeResultWithSnakeCase | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(true);
  const pending = useRef(false);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  const supported =
    Boolean(workbench.features?.includes("providerProbe")) &&
    !provider.includes(":");

  async function check() {
    if (pending.current) {
      return;
    }
    pending.current = true;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const next = await workbench.call<ProbeResultWithSnakeCase>(
        ...probeProvider(provider, profileId),
      );
      if (active.current) {
        setResult(next);
      }
    } catch (reason) {
      if (active.current) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      pending.current = false;
      if (active.current) {
        setBusy(false);
      }
    }
  }

  const caps =
    result?.capabilities &&
    typeof result.capabilities === "object" &&
    !Array.isArray(result.capabilities)
      ? (result.capabilities as Record<string, unknown>)
      : {};
  const authCmd =
    result?.authentication_command ?? result?.authenticationCommand;

  return (
    <section className="desktop-provider-probe" aria-label="Agent 环境探测">
      <div className="desktop-settings-row">
        <div>
          <h3>环境探测</h3>
          <p>
            只做初始化握手，不创建会话或发送任务。
            {profileId ? "检测已保存的启动配置。" : "检测内置默认入口。"}
          </p>
        </div>
        <button
          type="button"
          disabled={
            busy || dirty || !supported || workbench.phase !== "online"
          }
          onClick={() => void check()}
        >
          {busy ? "正在检测…" : "检查环境"}
        </button>
      </div>
      {dirty && (
        <p className="desktop-settings-help">
          启动参数已修改，请保存修订后再检查。
        </p>
      )}
      {!supported && (
        <p className="desktop-settings-help">
          {provider.includes(":")
            ? "插件入口通过会话连接验证。"
            : "请在执行结束后升级并重启工作主机，启用环境探测。"}
        </p>
      )}
      {busy && (
        <p role="status">正在连接启动入口，通常在 15 秒内完成…</p>
      )}
      {error && <p role="alert">{error}</p>}
      {result && (
        <div role="status">
          <div className="desktop-settings-row">
            <span>协议</span>
            <span>{states[result.state] ?? "未知探测结果"}</span>
          </div>
          {result.name && (
            <div className="desktop-settings-row">
              <span>桥接器</span>
              <span>
                {result.name}
                {result.version ? ` · ${result.version}` : " · 未上报版本"}
              </span>
            </div>
          )}
          <div className="desktop-settings-row">
            <span>认证</span>
            <span>
              {authentication[result.authentication] ?? authentication.unknown}
            </span>
          </div>
          {result.state === "ready" && (
            <div className="desktop-settings-row">
              <span>声明的能力</span>
              <span>
                {(
                  [
                    ["session", "会话"],
                    ["image", "图片"],
                    ["embeddedContext", "嵌入文件"],
                  ] as const
                )
                  .map(
                    ([key, label]) =>
                      `${label}：${caps[key] ? "已声明" : "未声明"}`,
                  )
                  .join(" · ")}
              </span>
            </div>
          )}
          {authCmd && result.authentication !== "authenticated" && (
            <p className="desktop-settings-help">
              可在本机终端完成登录：<code>{authCmd}</code>
              。本应用不会自动提交凭据。
            </p>
          )}
          <p className="desktop-settings-help">
            握手及 CLI 登录状态不代表模型请求一定成功；额度、网络和会话恢复仍以实际连接结果为准。修改启动配置后请重新检查。
          </p>
        </div>
      )}
    </section>
  );
}
