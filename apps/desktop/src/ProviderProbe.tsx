import React, { useEffect, useRef, useState } from "react";
import { Activity } from "lucide-react";
import {
  probeProvider,
  type ProviderProbeResponse,
} from "@vibeone/client-contracts";
import { Alert } from "./components/ui/alert.tsx";
import { Badge } from "./components/ui/badge.tsx";
import { Button } from "./components/ui/button.tsx";
import {
  SettingBlock,
  SettingItem,
  SettingSection,
} from "./components/ui/setting-layout.tsx";
import type { WorkbenchLike } from "./types.ts";

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
    <SettingSection
      title="环境探测"
      aria-label="Agent 环境探测"
      className="desktop-provider-probe"
    >
      <SettingItem
        title="握手与依赖检测"
        description={`只做初始化握手，不创建会话或发送任务。${profileId ? "检测已保存的启动配置。" : "检测内置默认入口。"}`}
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={
            busy || dirty || !supported || workbench.phase !== "online"
          }
          onClick={() => void check()}
        >
          <Activity size={13} />
          {busy ? "正在检测…" : "检查环境"}
        </Button>
      </SettingItem>

      {(dirty || !supported || busy || error) && (
        <SettingBlock className="space-y-2.5">
          {dirty && (
            <p className="m-0 text-[12px] text-[var(--muted)]">
              启动参数已修改，请保存修订后再检查。
            </p>
          )}
          {!supported && (
            <p className="m-0 text-[12px] text-[var(--muted)]">
              {provider.includes(":")
                ? "插件入口通过会话连接验证。"
                : "请在执行结束后升级并重启工作主机，启用环境探测。"}
            </p>
          )}
          {busy && (
            <Alert variant="info" role="status">
              正在连接启动入口，通常在 15 秒内完成…
            </Alert>
          )}
          {error && (
            <Alert variant="destructive" role="alert">
              {error}
            </Alert>
          )}
        </SettingBlock>
      )}

      {result && (
        <div role="status" className="divide-y divide-[var(--line)]">
          <SettingItem title="协议">
            <Badge variant={result.state === "ready" ? "success" : "warning"}>
              {states[result.state] ?? "未知探测结果"}
            </Badge>
          </SettingItem>
          {result.name && (
            <SettingItem title="桥接器">
              <span className="font-mono text-[12px]">
                {result.name}
                {result.version ? ` · ${result.version}` : " · 未上报版本"}
              </span>
            </SettingItem>
          )}
          <SettingItem title="认证">
            <Badge
              variant={
                result.authentication === "authenticated" ||
                result.authentication === "not_required"
                  ? "success"
                  : "secondary"
              }
            >
              {authentication[result.authentication] ?? authentication.unknown}
            </Badge>
          </SettingItem>
          {result.state === "ready" && (
            <SettingItem title="声明的能力">
              <span className="text-[12px] text-[var(--ink-secondary)]">
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
            </SettingItem>
          )}
          <SettingBlock className="space-y-2">
            {authCmd && result.authentication !== "authenticated" && (
              <p className="m-0 text-[12px] text-[var(--ink-secondary)]">
                可在本机终端完成登录：
                <code className="mx-1 rounded bg-[var(--hover)] px-1.5 py-0.5 font-mono text-[11.5px]">
                  {authCmd}
                </code>
                。本应用不会自动提交凭据。
              </p>
            )}
            <p className="m-0 text-[11.5px] leading-relaxed text-[var(--muted)]">
              握手及 CLI 登录状态不代表模型请求一定成功；额度、网络和会话恢复仍以实际连接结果为准。修改启动配置后请重新检查。
            </p>
          </SettingBlock>
        </div>
      )}
    </SettingSection>
  );
}
