import React, { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUp,
  Maximize2,
  Minimize2,
  Check,
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
  X,
} from "lucide-react";
import { ComposerInput } from "./ComposerInput.jsx";
import { useNotifications } from "./notifications.js";
import { RemoteSettings, PhoneGate } from "./Remote.jsx";
import { isNative } from "./api.js";
import { chooseWorkspace } from "./api.js";
import { useWorkbench } from "./use-workbench.js";
import { InputRequest } from "./InputRequest.jsx";
import { SessionTools, Queue } from "./SessionTools.jsx";
import { usePlugins, PluginManager } from "./plugins.jsx";
import { Management } from "./Management.jsx";
import { ChatMessage, AgentResponse } from "./ChatTimeline.jsx";
import { ConversationNav } from "./ConversationNav.jsx";
import { buildTurns } from "./chat-timeline.js";
import {SessionRow} from "./SessionIdentity.jsx";
import {AppearanceSettings,useAppearance} from "./AppearanceSettings.jsx";
import {readAppearance,applyAppearance} from "./appearance.js";
const SettingsCenter=lazy(()=>import("./SettingsCenter.jsx").then(module=>({default:module.SettingsCenter})));
import {SplitHandle} from "./SplitHandle.jsx";
import {PreviewContext} from "./PreviewLinks.jsx";
import {BrowserPreview} from "./BrowserPreview.jsx";
import { Brand } from "./Brand.jsx";
import "../../../prototype/src/theme.css";
import "./workbench.css";
import "./workspace-layout.css";

const labels = {
  idle: "就绪",
  starting: "正在启动",
  running: "运行中",
  requires_action: "等待审批",
  cancelling: "正在停止",
  disconnected: "已断开",
  interrupted: "已中断",
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
applyAppearance(readAppearance(),document.documentElement.dataset.theme);

function App() {
  const workbench = useWorkbench();
  const plugins = usePlugins(workbench);
  useNotifications(workbench);
  const [selected, setSelected] = useState(null);
  const [showList, setShowList] = useState(true);
  const [creating, setCreating] = useState(true);
  const [settings, setSettings] = useState(false);
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const [error, setError] = useState("");
  const [theme, setTheme] = useState(savedTheme);
  const appearance=useAppearance(theme);
  useEffect(()=>{const update=()=>document.documentElement.toggleAttribute('data-motion-paused',document.hidden);document.addEventListener('visibilitychange',update);update();return()=>document.removeEventListener('visibilitychange',update);},[]);
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
  const online = workbench.phase === "online" && !workbench.storageError;
  const session = workbench.sessions.find((session) => session.id === selected);
  const sessions = workbench.sessions.filter(
    (session) =>
      !!session.archived === archived &&
      `${session.title} ${session.workspace}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const pending = workbench.sessions.reduce(
    (count, session) =>
      count + session.approvals.length + (session.inputs?.length ?? 0),
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
    <div className={`desktop-app ${showList ? "mobile-list" : ""} ${settings?"settings-open":""}`}>
      <aside className="desktop-sidebar">
        <div className="desktop-brand">
          <Brand/>
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
              (session) => session.approvals.length || session.inputs?.length,
            );
            if (attention) {
              setSelected(attention.id);
              setCreating(false);
              setShowList(false);
              setSettings(false);
            } else setError("当前没有待处理的审批请求");
          }}
        >
          <ShieldCheck size={16} />
          待处理<span className="desktop-count">{pending}</span>
        </button>
        <div className="desktop-list-title">
          <button
            className="desktop-text-action"
            onClick={() => setArchived(!archived)}
          >
            {archived ? "已归档 · 查看会话" : "会话 · 查看归档"}
          </button>
          <button
            className="desktop-icon"
            aria-label="新建会话"
            onClick={() => {
              setCreating(true);
              setShowList(false);
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
              <SessionRow key={item.id} item={item} selected={!creating&&item.id===selected} provider={workbench.providers.find(provider=>provider.id===item.provider)?.name??item.provider} status={labels[item.status]??item.status} onSelect={()=>{setSelected(item.id);setCreating(false);setShowList(false);setSettings(false);}}/>
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
                  : workbench.phase === "upgrading"
                    ? "正在重启"
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
              onClick={() => (setSettings(!settings), setShowList(false))}
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
          <button
            className="mobile-open-list"
            onClick={() => setShowList(true)}
          >
            会话列表
          </button>
          <span>
            <span className={`desktop-dot ${online ? "online" : ""}`} />
            {online ? "工作主机 · 本机已连接" : workbench.phase === "upgrading" ? "正在重启工作主机" : "正在连接工作主机"}
          </span>
          <span>ACP v2 · 本地运行</span>
        </div>
        {online &&
          workbench.providers.length > 0 &&
          workbench.apiVersion !== 3 && (
            <div className="desktop-alert" role="status">
              当前主机为旧版本，请结束执行后在设置中重启工作主机，启用本版功能。
            </div>
          )}
        {(error || workbench.storageError || workbench.error || !online) && (
          <div className="desktop-alert" role="status">
            <span>
              {error ||
                workbench.storageError ||
                workbench.error ||
                (workbench.phase === "upgrading" ? "正在重启工作主机，会话记录已保存。" : "主机连接中，连接完成后可以创建会话。")}
            </span>
            {!online ? (
              <button disabled={workbench.phase === "upgrading"} onClick={() => void workbench.reconnect()}>
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
          <Suspense fallback={<p role="status">正在打开设置…</p>}><SettingsCenter workbench={workbench} plugins={plugins} theme={theme} setTheme={setTheme} onBack={()=>setSettings(false)} appearance={<AppearanceSettings theme={theme} setTheme={setTheme} appearance={appearance}/>}/></Suspense>
        ) : creating || !session ? (
          <NewSession
            workbench={workbench}
            online={
              online &&
              (!workbench.device || workbench.device.role === "operator")
            }
            act={act}
            onCreated={(id) => {
              setSelected(id);
              setCreating(false);
              setShowList(false);
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
  const profile = (workbench.profiles ?? []).find(
    (item) => item.id === provider,
  );
  const selected = workbench.providers.find(
    (item) => item.id === (profile?.provider ?? provider),
  );
  const create = async (event) => {
    event.preventDefault();
    setBusy(true);
    const result = await act(() =>
      workbench.call("/sessions", {
        provider: profile?.provider ?? provider,
        workspace,
        ...(profile ? { profileId: profile.id } : {}),
      }),
    );
    setBusy(false);
    if (result) onCreated(result.id);
  };
  return (
    <div className="desktop-setup">
      <div className="desktop-setup-heading">
        <MessageSquare size={23} />
        <h1>新会话</h1>
        <p>选择 Agent 即可开始，也可以关联已有项目。</p>
      </div>
      <form className="desktop-setup-form" onSubmit={create}>
        <label htmlFor="workspace">工作区{!workbench.device && "（可选）"}</label>
        {isNative() ? (
          <div className="desktop-path">
            <input
              id="workspace"
              list="saved-workspaces"
              value={workspace}
              onChange={(event) => setWorkspace(event.target.value)}
              placeholder="留空，自动创建新项目"
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
        ) : (
          <select
            id="workspace"
            value={workspace}
            onChange={(event) => setWorkspace(event.target.value)}
            required={!!workbench.device}
          >
            <option value="">{workbench.device ? "选择已授权工作区" : "自动创建新项目"}</option>
            {(workbench.workspaces ?? []).map((item) => (
              <option key={item.id} value={item.path}>
                {item.name}
              </option>
            ))}
          </select>
        )}
        <datalist id="saved-workspaces">
          {(workbench.workspaces ?? []).map((item) => (
            <option key={item.id} value={item.path}>
              {item.name}
            </option>
          ))}
        </datalist>
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
          {(workbench.profiles ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              配置 · {item.name}
            </option>
          ))}
        </select>
        <p className="desktop-field-help">
          {selected?.description ?? "正在检查本机工具。"}
        </p>
        <button
          className="desktop-button primary"
          disabled={
            !online ||
            (!!workbench.device && !workspace.trim()) ||
            busy ||
            !(selected?.available || profile?.command)
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
  const [draft, setDraft] = useState(() => {
    try {
      return localStorage.getItem(`vibeone-draft:${session.id}`) || "";
    } catch {
      return "";
    }
  });
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        if (draft)
          localStorage.setItem(
            `vibeone-draft:${session.id}`,
            draft.slice(0, 32768),
          );
        else localStorage.removeItem(`vibeone-draft:${session.id}`);
      } catch {}
    }, 300);
    return () => clearTimeout(timer);
  }, [draft, session.id]);
  const canOperate = !workbench.device || workbench.device.role === "operator";
  const canApprove =
    !workbench.device ||
    ["operator", "approver"].includes(workbench.device.role);
  const [editingTitle, setEditingTitle] = useState(false);
  const [tab, setTab] = useState("chat");
  const [panelWidth,setPanelWidth]=useState(null);
  const [browserHistory,setBrowserHistory]=useState({urls:[],index:-1}),[fileTarget,setFileTarget]=useState(null);
  const browserUrl=browserHistory.urls[browserHistory.index]??null;
  const openUrl=useCallback(url=>{setBrowserHistory(previous=>{if(previous.urls[previous.index]===url)return previous;const urls=[...previous.urls.slice(0,previous.index+1),url].slice(-100);return {urls,index:urls.length-1};});setTab('browser');},[]);
  const [expandedPanel,setExpandedPanel]=useState(false);
  const [changeSummary,setChangeSummary]=useState(null);
  const lastRun=session.runs?.at(-1);
  useEffect(()=>{let stale=false;setChangeSummary(null);if(online&&lastRun?.finishedAt)workbench.call(`/sessions/${session.id}/changes`).then(value=>{if(!stale)setChangeSummary(value);}).catch(()=>{});return()=>{stale=true;};},[session.id,lastRun?.id,lastRun?.finishedAt,online,workbench.call]);
  const openFile=useCallback(path=>{setFileTarget({path,key:crypto.randomUUID()});setTab('files');},[]);
  const previewContext=useMemo(()=>({workspace:session.workspace,openUrl,openFile}),[session.workspace,openUrl,openFile]);
  const requestKey = useRef(null);
  const [fileReferences, setFileReferences] = useState(() => {
    try { const saved=JSON.parse(localStorage.getItem(`vibeone-references:${session.id}`)||'[]'); return Array.isArray(saved)?saved.filter(path=>typeof path==='string').slice(0,5):[]; } catch {return [];}
  });
  const changeReferences = files => {
    setFileReferences(files); requestKey.current=null;
    try {if(files.length)localStorage.setItem(`vibeone-references:${session.id}`,JSON.stringify(files));else localStorage.removeItem(`vibeone-references:${session.id}`);}catch{}
  };
  const [title, setTitle] = useState(session.title);
  const readOnly = session.historyOnly || session.archived || !canOperate;
  const [sending, setSending] = useState(false);
  const [deciding, setDeciding] = useState(null);
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
  const locateRun=runId=>{
    const target=[...timeline.current.querySelectorAll('[data-turn-id]')].find(node=>node.dataset.turnId===runId);
    if(!target)return;
    followLatest.current=false;setFollowing(false);
    if(matchMedia('(max-width:800px)').matches)setTab('chat');
    requestAnimationFrame(()=>{const root=timeline.current;root.scrollTop+=target.getBoundingClientRect().top-root.getBoundingClientRect().top-16;target.focus({preventScroll:true});});
  };
  const contentLength = session.messages.reduce(
    (length, message) => length + message.text.length,
    0,
  );
  const turns = useMemo(() => buildTurns(session), [session.messages, session.tools, session.runs, session.status]);
  useLayoutEffect(() => {
    if (followLatest.current && timeline.current) timeline.current.scrollTop = timeline.current.scrollHeight;
  }, [contentLength, session.tools, session.approvals.length, session.inputs?.length, session.status]);
  const send = async () => {
    if (!draft.trim() || sending || !online || readOnly) return;
    followLatest.current = true;
    setFollowing(true);
    setSending(true);
    const result = await act(() =>
      workbench.call(`/sessions/${session.id}/messages`, {
        text: draft,
        files: fileReferences,
        key: (requestKey.current ??= crypto.randomUUID()),
      }),
    );
    if (result) {
      setDraft("");
      changeReferences([]);
      requestKey.current = null;
    }
    setSending(false);
  };
  return (
    <PreviewContext.Provider value={previewContext}>
      <header className="desktop-conversation-heading">
        <div>
          {editingTitle ? (
            <form
              className="desktop-title-form"
              onSubmit={async (event) => {
                event.preventDefault();
                const result = await act(() =>
                  workbench.call(`/sessions/${session.id}/metadata`, { title }),
                );
                if (result) setEditingTitle(false);
              }}
            >
              <input
                aria-label="会话标题"
                maxLength={120}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
              <button disabled={!online || !title.trim()}>保存标题</button>
              <button type="button" onClick={() => setEditingTitle(false)}>
                取消
              </button>
            </form>
          ) : (
            <h1>{session.title}</h1>
          )}
          {workbench.persistent && (
            <div className="desktop-session-actions">
              <button
                disabled={!online || !canOperate}
                onClick={() => {
                  setTitle(session.title);
                  setEditingTitle(true);
                }}
              >
                重命名
              </button>
              <button
                disabled={!online || !canOperate || active}
                onClick={() =>
                  void act(() =>
                    workbench.call(`/sessions/${session.id}/metadata`, {
                      archived: !session.archived,
                    }),
                  )
                }
              >
                {session.archived ? "取消归档" : "归档"}
              </button>
            </div>
          )}
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
      <nav className="desktop-session-tabs" aria-label="会话视图">
        {[
          ["chat", "对话"],
          ["changes", "变更"],
          ["files", "文件"],
          ["runs", "执行记录"],
          ["terminal", "终端"],
          ["browser", "网址浏览"],
          ["artifacts", "产物"],
          ["agent", "Agent 设置"],
        ].map(([id, label]) => (
          <button key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>
      <div className="desktop-conversation-body">
      <div className="desktop-chat-column">
      <div className="desktop-timeline-shell">
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
        {turns.map(turn => (
          <div className="desktop-turn" tabIndex={-1} key={turn.id} data-turn-id={turn.user?turn.id:undefined}>
            {turn.user && <ChatMessage message={turn.user} name={name}/>}
            <AgentResponse onChanges={()=>setTab('changes')} changeCount={turn.id===lastRun?.id&&changeSummary?.isGit?changeSummary.files.length:0} turn={turn} name={name} status={session.status} hasInput={!!session.inputs?.length} onReadHistory={()=>{followLatest.current=false;setFollowing(false);}}/>
          </div>
        ))}
        {(session.inputs ?? []).map((request) => (
          <InputRequest
            key={request.id}
            request={request}
            session={session}
            workbench={workbench}
            online={online && canOperate}
            act={act}
          />
        ))}
        {!!session.decisions?.length && (
          <details className="desktop-tools">
            <summary>人工处理回执</summary>
            {session.decisions.slice(-10).map((decision) => (
              <p key={decision.id}>
                {decision.option
                  ? `审批选择：${decision.option}`
                  : `补充输入：${decision.answer?.action ?? "已提交"}`}{" "}
                ·{" "}
                {{
                  pending: "决定已记录，等待投递",
                  sent: "已交给 ACP 响应通道",
                  uncertain: "投递不确定，不自动重发",
                }[decision.delivery] ?? decision.delivery}
              </p>
            ))}
          </details>
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
                    !canApprove ||
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
      </div>
      <ConversationNav turns={turns} timeline={timeline} onNavigate={()=>{followLatest.current=false;setFollowing(false);}}/>
      </div>
      {!following && (
        <div className="desktop-jump">
          <button
            className="desktop-button"
            onClick={() => {
              followLatest.current = true;
              setFollowing(true);
              if (timeline.current) timeline.current.scrollTop = timeline.current.scrollHeight;
            }}
          >
            回到最新消息
          </button>
        </div>
      )}
      <div className="desktop-composer-wrap">
        {session.historyOnly && !session.archived && canOperate && !(session.queue ?? []).length && (
          <div className="desktop-context-restart">
            <span>历史记录仍在。继续会启动新 Agent 上下文，不恢复旧工具进程，也不会自动发送旧消息。</span>
            <button className="desktop-button" disabled={!online || sending} onClick={async () => {
              setSending(true);
              await act(() => workbench.call(`/sessions/${session.id}/queue`, {resume:true,freshContext:true}));
              setSending(false);
            }}>在新上下文继续</button>
          </div>
        )}
        {!session.historyOnly && session.agentState?.contextRestartedAt && (
          <p className="desktop-field-help">正在新的 Agent 上下文中继续；上方旧消息仅作为本地历史保留。</p>
        )}
        <div className="desktop-composer">
          <Queue
            session={session}
            workbench={workbench}
            online={online && canOperate}
            act={act}
          />
          <ComposerInput session={session} workbench={workbench} value={draft}
            onChange={text=>{setDraft(text);requestKey.current=null;}}
            files={fileReferences} onFiles={changeReferences} onSubmit={()=>void send()}
            onPanel={setTab} disabled={readOnly || sending} online={online}
            placeholder={!canOperate ? "此设备仅可查看或审批，不能发送任务" : readOnly ? "先取消归档或在新上下文继续" : active ? "当前正在执行，发送后加入下一轮队列…" : "描述任务，输入 / 选择指令，@ 引用文件…"}/>
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
                readOnly ||
                !draft.trim() ||
                sending ||
                !online ||
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
              disabled={
                !online || !canOperate || session.status === "cancelling"
              }
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
            <span>
              {session.historyOnly
                ? "历史已保留 · Agent 上下文尚未恢复"
                : workbench.persistent
                  ? "会话已保存到本机"
                  : "本次主机运行期间保留会话"}
            </span>
          )}
        </div>
      </div>
      </div>
      {tab!=="chat" && <><SplitHandle onResize={width=>{setExpandedPanel(false);setPanelWidth(width);}}/><aside style={expandedPanel?{'--panel-width':'min(70%, 1100px)'}:panelWidth?{'--panel-width':`${panelWidth}px`}:undefined} className={`desktop-right-panel ${expandedPanel?'expanded-preview':''}`} aria-label="工作区预览"><header className="desktop-right-panel-header"><strong>{({changes:'变更',files:'文件',runs:'执行记录',terminal:'终端',browser:'网址浏览',artifacts:'产物',agent:'Agent 设置'})[tab]}</strong><button className="desktop-icon desktop-expand-preview" aria-label={expandedPanel?'恢复面板宽度':'扩大预览'} onClick={()=>setExpandedPanel(!expandedPanel)}>{expandedPanel?<Minimize2 size={15}/>:<Maximize2 size={15}/>}</button><button className="desktop-icon" aria-label="收起右侧面板" onClick={()=>setTab('chat')}><X size={15}/></button></header>{tab==='browser'?<BrowserPreview url={browserUrl} onNavigate={openUrl} canBack={browserHistory.index>0} canForward={browserHistory.index<browserHistory.urls.length-1} onBack={()=>setBrowserHistory(previous=>({...previous,index:Math.max(0,previous.index-1)}))} onForward={()=>setBrowserHistory(previous=>({...previous,index:Math.min(previous.urls.length-1,previous.index+1)}))}/>:<SessionTools key={tab} session={session} workbench={workbench} tab={tab} act={act} fileTarget={fileTarget} onLocateRun={locateRun} availableRunIds={turns.filter(turn=>turn.user).map(turn=>turn.id)}/>}</aside></>}
      </div>
    </PreviewContext.Provider>
  );
}

createRoot(document.getElementById("root")).render(
  isNative() ? (
    <App />
  ) : (
    <PhoneGate>
      <App />
    </PhoneGate>
  ),
);
