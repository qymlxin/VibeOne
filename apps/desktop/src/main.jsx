import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUp,
  Check,
  ChevronDown,
  FolderOpen,
  LoaderCircle,
  MessageSquare,
  Monitor,
  Moon,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Square,
  Sun,
  Terminal,
  X,
} from "lucide-react";
import { chooseWorkspace } from "./api.js";
import { useWorkbench } from "./use-workbench.js";
import mark from "../../../assets/brand/vibeone-logo-mark.svg";
import "../../../prototype/src/theme.css";
import "./workbench.css";

const labels = {
  idle: "就绪",
  starting: "正在启动",
  running: "运行中",
  requires_action: "等待审批",
  cancelling: "正在停止",
  disconnected: "已断开",
  error: "执行失败",
};
function savedTheme() {
  try {
    return localStorage.getItem("vibeone-theme") || "system";
  } catch {
    return "system";
  }
}
function applyTheme(theme) {
  document.documentElement.dataset.theme =
    theme === "system"
      ? matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;
}
applyTheme(savedTheme());

function App() {
  const workbench = useWorkbench();
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(true);
  const [settings, setSettings] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [theme, setTheme] = useState(savedTheme);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => applyTheme(theme);
    apply();
    media.addEventListener("change", apply);
    try {
      localStorage.setItem("vibeone-theme", theme);
    } catch {
      /* The in-memory preference still works. */
    }
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  const online = workbench.phase === "online";
  const session = workbench.sessions.find((session) => session.id === selected);
  const sessions = workbench.sessions.filter((session) =>
    `${session.title} ${session.workspace}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const pending = workbench.sessions.reduce(
    (count, session) => count + session.approvals.length,
    0,
  );
  const act = async (operation) => {
    setError("");
    try {
      return await operation();
    } catch (error) {
      setError(error.message ?? String(error));
      return null;
    }
  };
  return (
    <div className="desktop-app">
      <aside className="desktop-sidebar">
        <div className="desktop-brand">
          <img src={mark} alt="" />
          <span>VibeOne</span>
        </div>
        <button
          className="desktop-nav active"
          onClick={() => {
            setSettings(false);
          }}
        >
          <MessageSquare size={16} />
          工作台
        </button>
        <button
          className="desktop-nav"
          onClick={() => {
            const attention = workbench.sessions.find(
              (session) => session.approvals.length,
            );
            if (attention) {
              setSelected(attention.id);
              setCreating(false);
              setSettings(false);
            } else setError("当前没有待处理的审批请求");
          }}
        >
          <ShieldCheck size={16} />
          待处理<span className="desktop-count">{pending}</span>
        </button>
        <div className="desktop-list-title">
          <span>会话</span>
          <button
            className="desktop-icon"
            aria-label="新建会话"
            onClick={() => {
              setCreating(true);
              setSettings(false);
            }}
          >
            <Plus size={17} />
          </button>
        </div>
        <label className="desktop-search">
          <Search size={14} />
          <input
            aria-label="搜索会话"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索会话或工作区"
          />
        </label>
        <div className="desktop-session-list">
          {sessions.length ? (
            sessions.map((item) => (
              <button
                key={item.id}
                className={`desktop-session ${!creating && item.id === selected ? "selected" : ""}`}
                onClick={() => {
                  setSelected(item.id);
                  setCreating(false);
                  setSettings(false);
                }}
              >
                <strong>{item.title}</strong>
                <span>
                  {workbench.providers.find(
                    (provider) => provider.id === item.provider,
                  )?.name ?? item.provider}
                  <small>{labels[item.status] ?? item.status}</small>
                </span>
              </button>
            ))
          ) : (
            <p className="desktop-list-empty">
              {query ? "没有匹配的会话" : "从一个新会话开始"}
            </p>
          )}
        </div>
        <div className="desktop-sidebar-bottom">
          <div className="desktop-host">
            <span className={`desktop-dot ${online ? "online" : ""}`} />
            <div>
              <strong>工作主机</strong>
              <small>
                {online
                  ? "本机 · 已连接"
                  : workbench.phase === "connecting"
                    ? "正在连接"
                    : "连接已断开"}
              </small>
            </div>
            <Monitor size={16} />
          </div>
          <div className="desktop-sidebar-actions">
            <button
              className="desktop-icon"
              aria-label="连接与设置"
              onClick={() => setSettings(!settings)}
            >
              <Settings2 size={16} />
            </button>
            <label className="desktop-theme">
              {theme === "dark" ? <Moon size={14} /> : <Sun size={14} />}
              <select
                aria-label="主题"
                value={theme}
                onChange={(event) => setTheme(event.target.value)}
              >
                <option value="system">跟随系统</option>
                <option value="light">亮色</option>
                <option value="dark">暗色</option>
              </select>
            </label>
          </div>
        </div>
      </aside>
      <main className="desktop-main">
        <div className="desktop-connection">
          <span>
            <span className={`desktop-dot ${online ? "online" : ""}`} />
            {online ? "工作主机 · 本机已连接" : "正在连接工作主机"}
          </span>
          <span>ACP v2 · 本地运行</span>
        </div>
        {(error || workbench.error || !online) && (
          <div className="desktop-alert" role="status">
            <span>
              {error ||
                workbench.error ||
                "主机连接中，连接完成后可以创建会话。"}
            </span>
            {!online ? (
              <button onClick={() => void workbench.reconnect()}>
                <RefreshCw size={14} />
                重新连接
              </button>
            ) : (
              <button
                className="desktop-icon"
                aria-label="关闭提示"
                onClick={() => setError("")}
              >
                <X size={14} />
              </button>
            )}
          </div>
        )}
        {settings ? (
          <Settings workbench={workbench} />
        ) : creating || !session ? (
          <NewSession
            workbench={workbench}
            online={online}
            act={act}
            onCreated={(id) => {
              setSelected(id);
              setCreating(false);
            }}
          />
        ) : (
          <Conversation
            key={session.id}
            session={session}
            workbench={workbench}
            online={online}
            act={act}
          />
        )}
      </main>
    </div>
  );
}

function NewSession({ workbench, online, act, onCreated }) {
  const [workspace, setWorkspace] = useState("");
  const [provider, setProvider] = useState("demo");
  const [busy, setBusy] = useState(false);
  const selected = workbench.providers.find((item) => item.id === provider);
  const create = async (event) => {
    event.preventDefault();
    setBusy(true);
    const result = await act(() =>
      workbench.call("/sessions", { provider, workspace }),
    );
    setBusy(false);
    if (result) onCreated(result.id);
  };
  return (
    <div className="desktop-setup">
      <div className="desktop-setup-heading">
        <MessageSquare size={23} />
        <h1>新会话</h1>
        <p>选择工作区和 Agent，开始一次任务。</p>
      </div>
      <form className="desktop-setup-form" onSubmit={create}>
        <label htmlFor="workspace">工作区</label>
        <div className="desktop-path">
          <input
            id="workspace"
            value={workspace}
            onChange={(event) => setWorkspace(event.target.value)}
            placeholder="选择或输入项目目录"
            required
          />
          <button
            type="button"
            aria-label="选择工作区目录"
            onClick={async () => {
              const path = await act(chooseWorkspace);
              if (path) setWorkspace(path);
            }}
          >
            <FolderOpen size={16} />
          </button>
        </div>
        <label htmlFor="agent">Agent</label>
        <select
          id="agent"
          value={provider}
          onChange={(event) => setProvider(event.target.value)}
        >
          {workbench.providers.length ? (
            workbench.providers.map((item) => (
              <option key={item.id} value={item.id} disabled={!item.available}>
                {item.name}
                {!item.available ? " · 未安装" : ""}
              </option>
            ))
          ) : (
            <option>正在读取工具</option>
          )}
        </select>
        <p className="desktop-field-help">
          {selected?.description ?? "正在检查本机工具。"}
        </p>
        <button
          className="desktop-button primary"
          disabled={
            !online || !workspace.trim() || busy || !selected?.available
          }
        >
          {busy ? (
            <LoaderCircle size={15} className="desktop-spin" />
          ) : (
            <Plus size={15} />
          )}
          创建会话
        </button>
      </form>
      <div className="desktop-setup-note">
        <ShieldCheck size={15} />
        <p>创建会话不会立即启动 Agent。发送第一条消息后才开始执行。</p>
      </div>
    </div>
  );
}

function Conversation({ session, workbench, online, act }) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [deciding, setDeciding] = useState(null);
  const bottom = useRef(null);
  const timeline = useRef(null);
  const followLatest = useRef(true);
  const [following, setFollowing] = useState(true);
  const name =
    workbench.providers.find((provider) => provider.id === session.provider)
      ?.name ?? session.provider;
  const active = [
    "starting",
    "running",
    "requires_action",
    "cancelling",
  ].includes(session.status);
  const contentLength = session.messages.reduce(
    (length, message) => length + message.text.length,
    0,
  );
  useEffect(() => {
    if (followLatest.current) bottom.current?.scrollIntoView({ block: "end" });
  }, [contentLength, session.approvals.length]);
  const send = async () => {
    if (!draft.trim() || sending || !online || active) return;
    setSending(true);
    const result = await act(() =>
      workbench.call(`/sessions/${session.id}/messages`, { text: draft }),
    );
    if (result) setDraft("");
    setSending(false);
  };
  return (
    <>
      <header className="desktop-conversation-heading">
        <div>
          <h1>{session.title}</h1>
          <p title={session.workspace}>
            <FolderOpen size={12} />
            {session.workspace}
            <span>/</span>
            {name}
          </p>
        </div>
        <span
          className={`desktop-status ${session.status === "requires_action" ? "attention" : ""}`}
        >
          {active ? (
            <LoaderCircle
              size={13}
              className={
                session.status === "requires_action" ? "" : "desktop-spin"
              }
            />
          ) : ["error", "disconnected"].includes(session.status) ? (
            <X size={13} />
          ) : (
            <Check size={13} />
          )}
          {labels[session.status] ?? session.status}
        </span>
      </header>
      <div
        className="desktop-timeline"
        ref={timeline}
        onScroll={(event) => {
          const element = event.currentTarget;
          const nearBottom =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            56;
          followLatest.current = nearBottom;
          setFollowing(nearBottom);
        }}
      >
        {!session.messages.length && (
          <div className="desktop-chat-empty">
            <MessageSquare size={26} />
            <h2>会话已准备好</h2>
            <p>
              {session.provider === "demo"
                ? "发送任意消息体验流式响应；/approve 体验审批，/wait 体验停止。"
                : `发送任务后将启动 ${name}。请先在本机完成该工具的认证。`}
            </p>
          </div>
        )}
        {session.messages.map((message) => (
          <article
            key={`${message.role}:${message.id}`}
            className={`desktop-message ${message.role}`}
          >
            <span className="desktop-avatar">
              {message.role === "user" ? (
                "你"
              ) : message.role === "thought" ? (
                <Terminal size={14} />
              ) : (
                <MessageSquare size={14} />
              )}
            </span>
            <div>
              <div className="desktop-message-meta">
                <strong>
                  {message.role === "user"
                    ? "你"
                    : message.role === "thought"
                      ? `${name} · 思考`
                      : name}
                </strong>
                {message.pending ? <span>已受理 · 等待 Agent 接受</span> : null}
              </div>
              <div className="desktop-message-text">{message.text || "…"}</div>
            </div>
          </article>
        ))}
        {session.tools.length > 0 && (
          <section className="desktop-tools">
            <h2>
              <Terminal size={14} />
              工具执行
            </h2>
            {session.tools.map((tool) => (
              <details key={tool.toolCallId}>
                <summary>
                  <span>{tool.title ?? tool.name ?? "工具调用"}</span>
                  <span>
                    {tool.status ?? "处理中"}
                    <ChevronDown size={13} />
                  </span>
                </summary>
                <pre>
                  {JSON.stringify(
                    tool.rawInput ?? tool.content ?? tool,
                    null,
                    2,
                  )}
                </pre>
              </details>
            ))}
          </section>
        )}
        {session.approvals.map((approval) => (
          <section className="desktop-approval" key={approval.id}>
            <h2>
              <ShieldCheck size={18} />
              {approval.title}
            </h2>
            {approval.description ? <p>{approval.description}</p> : null}
            {approval.subject ? (
              <pre>{JSON.stringify(approval.subject, null, 2)}</pre>
            ) : null}
            <div className="desktop-approval-actions">
              {approval.options.map((option) => (
                <button
                  key={option.optionId}
                  className={`desktop-button ${option.kind.startsWith("allow") ? "primary" : ""}`}
                  disabled={
                    !online ||
                    deciding === approval.id ||
                    session.status === "cancelling"
                  }
                  onClick={async () => {
                    setDeciding(approval.id);
                    await act(() =>
                      workbench.call(
                        `/sessions/${session.id}/approvals/${approval.id}`,
                        { option: option.optionId },
                      ),
                    );
                    setDeciding(null);
                  }}
                >
                  {option.name}
                </button>
              ))}
            </div>
          </section>
        ))}
        {session.error ? (
          <div className="desktop-run-error" role="alert">
            <strong>连接或执行未完成</strong>
            <pre>{session.error}</pre>
            <p>请检查本机工具认证和网络，或新建会话重试。</p>
          </div>
        ) : null}
        {session.stopReason ? (
          <p className="desktop-turn-end">
            {session.stopReason === "cancelled"
              ? "本轮已停止"
              : session.stopReason === "end_turn"
                ? "本轮执行结束"
                : `本轮已结束 · ${session.stopReason}`}
          </p>
        ) : null}
        <div ref={bottom} />
      </div>
      {!following && (
        <div className="desktop-jump">
          <button
            className="desktop-button"
            onClick={() => {
              followLatest.current = true;
              setFollowing(true);
              bottom.current?.scrollIntoView({ block: "end" });
            }}
          >
            回到最新消息
          </button>
        </div>
      )}
      <div className="desktop-composer-wrap">
        <div className="desktop-composer">
          <textarea
            aria-label="发送任务"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={
              active
                ? "可以先编辑草稿，等当前轮次结束后发送…"
                : "描述任务，或发送新的指令…"
            }
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <div>
            <span>
              <MessageSquare size={13} />
              {name}
              <span className="desktop-divider" />
              当前工作区
            </span>
            <button
              className="desktop-send"
              aria-label="发送消息"
              disabled={
                !draft.trim() ||
                sending ||
                !online ||
                active ||
                session.status === "disconnected"
              }
              onClick={() => void send()}
            >
              {sending ? (
                <LoaderCircle size={16} className="desktop-spin" />
              ) : (
                <ArrowUp size={17} />
              )}
            </button>
          </div>
        </div>
        <div className="desktop-composer-footer">
          <span>Enter 发送 · Shift+Enter 换行</span>
          {active ? (
            <button
              disabled={!online || session.status === "cancelling"}
              onClick={() =>
                void act(() =>
                  workbench.call(`/sessions/${session.id}/cancel`, {}),
                )
              }
            >
              <Square size={11} />
              {session.status === "cancelling" ? "正在停止" : "停止执行"}
            </button>
          ) : (
            <span>本次主机运行期间保留会话</span>
          )}
        </div>
      </div>
    </>
  );
}

function Settings({ workbench }) {
  return (
    <div className="desktop-settings">
      <h1>连接与工具</h1>
      <p>
        当前是桌面开发预览版。会话随本次 Host
        运行保留，数据库历史与手机配对尚未接入。
      </p>
      <h2>Agent 接入</h2>
      {workbench.providers.map((provider) => (
        <div className="desktop-provider" key={provider.id}>
          <div>
            <strong>{provider.name}</strong>
            <p>{provider.description}</p>
          </div>
          <span>{provider.available ? "启动入口可用" : "未找到启动入口"}</span>
        </div>
      ))}
      <p>
        入口可用不代表已认证。Codex 与 Claude Code
        使用本机已有的工具认证；认证失败会在会话中显示原因。
      </p>
      <h2>协议</h2>
      <dl>
        <dt>Agent 通信</dt>
        <dd>ACP v2 Draft · Rust SDK 5.0.0</dd>
        <dt>插件通信</dt>
        <dd>独立的 Plugin RPC v1</dd>
      </dl>
      <button
        className="desktop-button"
        onClick={() => void workbench.reconnect()}
      >
        <RefreshCw size={14} />
        重新连接主机
      </button>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
