import {createSession as createSessionCommand,submitMessage as submitMessageCommand} from "@vibeone/client-contracts";
import React, { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUp,
  MoreHorizontal, GitBranch, Paperclip, Slash, AtSign, ChevronDown,
  GitCompareArrows, FileCode, Terminal, Globe, Layers, Pencil, Archive,
  Maximize2,
  PanelLeft,
  ChevronRight,
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
import { AttachmentPicker,useAttachmentDraft } from "./Attachments.jsx";
import { recentSessions } from "./session-groups.js";
import {useProjects,projectGroups} from "./projects.jsx";
import { AgentConfigControls } from "./AgentConfigControls.jsx";
import { ComposerInput } from "./ComposerInput.jsx";
import { commandPanel } from "./composer.js";
import {useStopCommand} from './use-stop-command.js';
import {useQueueCommands} from './use-queue-commands.js';
import {useArtifactCapture} from './use-artifact-capture.js';
import {useMetadataCommands} from './use-metadata-commands.js';
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
import { useConversationHistory } from "./use-conversation-history.js";
import { captureHistoryAnchor,restoreHistoryAnchor } from "./conversation-history.js";
import {SessionRow} from "./SessionIdentity.jsx";
import {AppearanceSettings,useAppearance} from "./AppearanceSettings.jsx";
import {readAppearance,applyAppearance} from "./appearance.js";
const SettingsCenter=lazy(()=>import("./SettingsCenter.jsx").then(module=>({default:module.SettingsCenter})));
import {SplitHandle} from "./SplitHandle.jsx";
import {PreviewContext} from "./PreviewLinks.jsx";
import {BrowserPreview} from "./BrowserPreview.jsx";
import { Brand } from "./Brand.jsx";
import {ApprovedWorkbenchShell,primaryTools,IconButton} from "./ApprovedWorkbenchShell.jsx";
import "./approved/review.css";
import "./approved/settings-review.css";
import "./runtime-states.css";

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
function sessionLabel(session) {
  if (session.inputs?.length && ["starting", "running", "requires_action"].includes(session.status)) {
    return session.approvals?.length ? "等待处理" : "等待补充信息";
  }
  return labels[session.status] ?? session.status;
}
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
  const projects=useProjects(workbench);
  const [newProject,setNewProject]=useState('');
  useNotifications(workbench);
  const [selected, setSelected] = useState(null);
  const [showList, setShowList] = useState(true);
  const [creating, setCreating] = useState(true);
  const [settings, setSettings] = useState(false);
  const [query, setQuery] = useState("");
  const searchInput=useRef(null);
  const [sidebarOpen,setSidebarOpen]=useState(()=>{try{return localStorage.getItem('vibeone-sidebar-open')!=='false';}catch{return true;}});
  const sessionView='projects';
  const [collapsedProjects,setCollapsedProjects]=useState(new Set());
  const [settingsTarget,setSettingsTarget]=useState('general');
  const [panel,setPanel]=useState('chat'),[panelWidth,setPanelWidth]=useState(null),[expandedPanel,setExpandedPanel]=useState(false);
  useEffect(()=>{try{localStorage.setItem('vibeone-sidebar-open',String(sidebarOpen));localStorage.setItem('vibeone-session-view-v2',sessionView);}catch{}},[sidebarOpen,sessionView]);
  useEffect(()=>{const search=event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();setSidebarOpen(true);setShowList(true);setSettings(false);requestAnimationFrame(()=>{searchInput.current?.focus();searchInput.current?.select();});}};document.addEventListener('keydown',search);return()=>document.removeEventListener('keydown',search);},[]);

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
  const sessions = recentSessions(workbench.sessions.filter(
    (session) =>
      !!session.archived === archived &&
      `${session.title} ${session.workspace}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  ));
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
  const renderSession=item=><SessionRow key={item.id} item={item} selected={!creating&&item.id===selected} provider={workbench.providers.find(provider=>provider.id===item.provider)?.name??item.provider} status={sessionLabel(item)} onSelect={()=>{setSelected(item.id);setCreating(false);setShowList(false);setSettings(false);}}/>;
  const mode=appearance.dark?'dark':'light',colors=appearance.value[mode];
  const colorStyle={'--accent':appearance.value.accent,'--link':'color-mix(in srgb,var(--accent) 70%,var(--fg))',...(panelWidth?{'--panel-width':`${panelWidth}px`}:{}),...(colors.background||colors.foreground?{'--bg':colors.background??(appearance.dark?'#181818':'#FFFFFF'),'--fg':colors.foreground??(appearance.dark?'#FFFFFF':'#1A1C1F'),'--sidebar':'color-mix(in srgb,var(--bg) 97%,var(--fg))','--panel':'var(--bg)','--bar':'color-mix(in srgb,var(--bg) 94%,var(--fg))','--raised':'color-mix(in srgb,var(--bg) 91%,var(--fg))','--hover':'color-mix(in srgb,var(--bg) 92%,var(--fg))','--selected':'color-mix(in srgb,var(--bg) 86%,var(--fg))','--muted':'color-mix(in srgb,var(--fg) 64%,var(--bg))','--line':'color-mix(in srgb,var(--bg) 88%,var(--fg))','--border':'color-mix(in srgb,var(--bg) 62%,var(--fg))'}:{})};
  return <ApprovedWorkbenchShell dark={appearance.dark} colorStyle={colorStyle} sidebarOpen={sidebarOpen} hasPanel={panel!=='chat'&&!settings&&!creating&&!!session} wide={expandedPanel} settings={settings} native={isNative()} mobileList={showList} title={creating||!session?'新会话':session.title} connectionLabel={online?'工作主机 · 本机已连接':workbench.phase==='upgrading'?'正在重启工作主机':'正在连接工作主机'} onToggleSidebar={()=>setSidebarOpen(!sidebarOpen)} onOpenList={()=>{setSidebarOpen(true);setShowList(true);}} panel={panel} onPanel={value=>{setSettings(false);setPanel(value);}} sidebar={
      <aside className="session-sidebar desktop-sidebar">
        <div className="brand desktop-brand">
          <Brand/>          <button
            className="icon-button desktop-icon"
            aria-label="新建会话"
            onClick={() => {
              setNewProject(projects.items.find(p=>p.paths.includes(session?.workspace))?.id??'');
              setCreating(true);
              setShowList(false);
              setSettings(false);
            }}
          >
            <Plus size={17} />
          </button>
        </div>
        <label className="session-search desktop-search">
          <Search size={14} />
          <input
            aria-label="搜索会话"
            ref={searchInput}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索会话"
          /><kbd>⌘ K</kbd>
        </label>
        <button
          className="sidebar-action desktop-nav"
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
          待处理<span className="count desktop-count">{pending}</span>
        </button>
        <div className="session-list desktop-session-list">
          <div className="section-label"><span>{archived?'已归档':'项目'}</span><div className="session-list-actions">
            {!workbench.device&&<button className="icon-button" aria-label="添加项目" onClick={()=>{setSettingsTarget('workspaces');setSettings(true);setShowList(false);}}><Plus size={13}/></button>}
            <details className="workbench-tool-menu"><summary className="icon-button" aria-label="会话列表选项"><MoreHorizontal size={14}/></summary><div>

              <button onClick={event=>{setArchived(!archived);event.currentTarget.closest('details').open=false;}}>{archived?'已归档 · 查看会话':'会话 · 查看归档'}</button>
            </div></details>
          </div></div>
          {projectGroups(sessions,projects.items,workbench.workspaces).map(group=><section className="desktop-project-group" key={group.id}><div className="project-sidebar-heading"><button className="project-name desktop-project-heading" title={group.paths.join('\n')} aria-expanded={!!query.trim()||!collapsedProjects.has(group.id)} onClick={()=>setCollapsedProjects(previous=>{const next=new Set(previous);if(next.has(group.id))next.delete(group.id);else next.add(group.id);return next;})}><ChevronRight size={12}/><FolderOpen size={13}/><span>{group.name}</span><small>{group.sessions.length}</small></button><button className="icon-button" aria-label={`在项目 ${group.name} 新建会话`} onClick={()=>{setNewProject(group.id);setCreating(true);setSettings(false);setShowList(false);}}><Plus size={13}/></button></div>{(!!query.trim()||!collapsedProjects.has(group.id))&&group.sessions.map(renderSession)}</section>)}
          {!sessions.length&&!projects.items.some(p=>!p.implicit)&&<p className="desktop-list-empty">{query?'没有匹配的会话':'从一个新项目开始'}</p>}

        </div>
        <div className="sidebar-footer desktop-sidebar-bottom">
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
          <div className="sidebar-bottom desktop-sidebar-actions">
            <button
              className="icon-button desktop-icon"
              aria-label="连接与设置"
              onClick={() => {setSettingsTarget('general');setSettings(!settings);setShowList(false);}}
            >
              <Settings2 size={16} />
            </button>
            <label className="theme-select desktop-theme">
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
      }>

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
          <Suspense fallback={<p role="status">正在打开设置…</p>}><SettingsCenter key={settingsTarget} initialPage={settingsTarget} projects={projects} workbench={workbench} plugins={plugins} theme={theme} setTheme={setTheme} onBack={()=>setSettings(false)} appearance={<AppearanceSettings theme={theme} setTheme={setTheme} appearance={appearance} onBack={()=>setSettings(false)}/>}/></Suspense>
        ) : creating || !session ? (
          <NewSession
            key={newProject}
            projects={projects} initialProject={newProject||projects.items.find(p=>p.paths.includes(session?.workspace))?.id}
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
            act={act} tab={panel} setTab={setPanel} panelWidth={panelWidth} setPanelWidth={setPanelWidth} expandedPanel={expandedPanel} setExpandedPanel={setExpandedPanel}
          />
        )}
    </ApprovedWorkbenchShell>;
}

function NewSession({ workbench, online, act, onCreated,projects,initialProject }) {
  const [projectId,setProjectId]=useState(initialProject??'');
  const project=projects.items.find(p=>p.id===projectId);
  const creation = useRef(null);
  const [workspace, setWorkspace] = useState(()=>projects.items.find(p=>p.id===initialProject)?.paths[0]??"");
  const [provider, setProvider] = useState("codex");
  const [busy, setBusy] = useState(false);
  const profile = (workbench.profiles ?? []).find(
    (item) => item.id === provider,
  );
  const selected = workbench.providers.find(
    (item) => item.id === (profile?.provider ?? provider),
  );
  const create = async (event) => {
    event.preventDefault();
    if(creation.current?.busy)return;
    const signature=JSON.stringify([profile?.provider??provider,workspace,profile?.id??null]);
    if(creation.current?.signature!==signature)creation.current={signature,key:crypto.randomUUID(),busy:false};
    const intent=creation.current;
    intent.busy=true;
    setBusy(true);
    try {
      const result = await act(() =>
        workbench.call(...createSessionCommand(profile?.provider ?? provider,workspace,profile?.id,
          workbench.features?.includes('sessionCreationIdempotency')?intent.key:undefined)),
      );
      if (result) {
        if(project){const snapshot=await workbench.call('/snapshot');const created=snapshot.sessions.find(s=>s.id===result.id);if(created&&!project.paths.includes(created.workspace)){const saved=await act(()=>projects.save({id:project.id,addPath:created.workspace}));if(!saved)return;}}
        await projects.reload();creation.current=null;onCreated(result.id);
      }
    } finally {intent.busy=false;setBusy(false);}
  };
  return (
    <div className="desktop-setup">
      <div className="desktop-setup-heading">
        <MessageSquare size={23} />
        <h1>新会话</h1>
        <p>选择 Agent 即可开始，也可以关联已有项目。</p>
      </div>
      <form className="desktop-setup-form" onSubmit={create}>
        <label htmlFor="session-project">项目</label><select id="session-project" value={projectId} onChange={e=>{setProjectId(e.target.value);setWorkspace(projects.items.find(p=>p.id===e.target.value)?.paths[0]??'');}}><option value="">按工作目录自动归入项目</option>{projects.items.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
        {project&&<><label htmlFor="project-directory">项目工作目录</label><select id="project-directory" value={project.paths.includes(workspace)?workspace:''} onChange={e=>setWorkspace(e.target.value)}><option value="">新建或引入其他目录</option>{project.paths.map(path=><option key={path} value={path}>{path}</option>)}</select></>}

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

function Conversation({ session, workbench, online, act,tab,setTab,panelWidth,setPanelWidth,expandedPanel,setExpandedPanel }) {
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
  const [browserHistory,setBrowserHistory]=useState({urls:[],index:-1}),[fileTarget,setFileTarget]=useState(null);
  const browserUrl=browserHistory.urls[browserHistory.index]??null;
  const openUrl=useCallback(url=>{setBrowserHistory(previous=>{if(previous.urls[previous.index]===url)return previous;const urls=[...previous.urls.slice(0,previous.index+1),url].slice(-100);return {urls,index:urls.length-1};});setTab('browser');},[]);
  const [changeSummary,setChangeSummary]=useState(null);
  const lastRun=session.runs?.at(-1);
  const stopCurrentRun=useStopCommand(workbench,session);
  const queueCommands=useQueueCommands(workbench,session.id);
  const artifactCapture=useArtifactCapture(workbench,session.id);
  const metadataCommands=useMetadataCommands(workbench,session.id);
  useEffect(()=>{let stale=false;setChangeSummary(null);if(online&&lastRun?.finishedAt)workbench.call(`/sessions/${session.id}/changes`).then(value=>{if(!stale)setChangeSummary(value);}).catch(()=>{});return()=>{stale=true;};},[session.id,lastRun?.id,lastRun?.finishedAt,online,workbench.call]);
  const openFile=useCallback(path=>{setFileTarget({path,key:crypto.randomUUID()});setTab('files');},[]);
  const previewContext=useMemo(()=>({workspace:session.workspace,sessionId:session.id,read:workbench.read,openUrl,openFile}),[session.workspace,session.id,workbench.read,openUrl,openFile]);
  const requestKey = useRef(null),attachmentInput=useRef(null),composerActions=useRef(null),contextControl=useRef(null);
  const [contextMenuOpen,setContextMenuOpen]=useState(false);
  useEffect(()=>{if(!contextMenuOpen)return;const close=event=>{if(event.type==='keydown'&&event.key==='Escape'){setContextMenuOpen(false);contextControl.current?.querySelector('button')?.focus();}else if(event.type==='pointerdown'&&!contextControl.current?.contains(event.target))setContextMenuOpen(false);};document.addEventListener('pointerdown',close);document.addEventListener('keydown',close);return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',close);};},[contextMenuOpen]);
  const [fileReferences, setFileReferences] = useState(() => {
    try { const saved=JSON.parse(localStorage.getItem(`vibeone-references:${session.id}`)||'[]'); return Array.isArray(saved)?saved.filter(path=>typeof path==='string').slice(0,5):[]; } catch {return [];}
  });
  const changeReferences = files => {
    setFileReferences(files); requestKey.current=null;
    try {if(files.length)localStorage.setItem(`vibeone-references:${session.id}`,JSON.stringify(files));else localStorage.removeItem(`vibeone-references:${session.id}`);}catch{}
  };
  const [title, setTitle] = useState(session.title);
  const readOnly = session.archived || !canOperate;
  const [sending, setSending] = useState(false);
  const attachmentDraft=useAttachmentDraft({session,workbench,disabled:readOnly||sending,onMutate:()=>{requestKey.current=null;}});
  const [deciding, setDeciding] = useState(null);
  const timeline = useRef(null);
  const followLatest = useRef(true);
  const [following, setFollowing] = useState(true);
  const historyAnchor=useRef(null);
  const beforeHistoryMerge=useCallback(()=>{
    if(!followLatest.current&&!historyAnchor.current)historyAnchor.current=captureHistoryAnchor(timeline.current);
  },[]);
  const history=useConversationHistory({session,workbench,online,onBeforeMerge:beforeHistoryMerge});
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
  const contentLength = history.session.messages.reduce(
    (length, message) => length + (message.text?.length??0),
    0,
  );
  const turns = useMemo(() => buildTurns(history.session), [history.session.messages, history.session.tools, session.runs, session.status]);
  useLayoutEffect(() => {
    if(historyAnchor.current){restoreHistoryAnchor(timeline.current,historyAnchor.current);historyAnchor.current=null;}
    else if (followLatest.current && timeline.current) timeline.current.scrollTop = timeline.current.scrollHeight;
  }, [contentLength, history.session.messages,history.session.tools, session.approvals.length, session.inputs?.length, session.status]);
  const send = async () => {
    if ((!draft.trim()&&!fileReferences.length&&!attachmentDraft.items.length) || attachmentDraft.busy || sending || !online || readOnly) return;
    const panel=commandPanel(draft,session.agentState?.commands);
    if(panel&&!fileReferences.length&&!attachmentDraft.items.length){setTab(panel);setDraft('');requestKey.current=null;return;}
    followLatest.current = true;
    setFollowing(true);
    setSending(true);
    const result = await act(() =>
      workbench.call(...submitMessageCommand(session.id,draft,fileReferences,attachmentDraft.items.map(item=>item.id),(requestKey.current ??= crypto.randomUUID()))),
    );
    if (result) {
      setDraft("");
      changeReferences([]);
      attachmentDraft.replace([]);
      requestKey.current = null;
    }
    setSending(false);
  };
  const toolNavigation=<>{primaryTools.map(([id,label,Icon])=><button key={id} className={tab===id?'active':''} aria-label={label} aria-pressed={tab===id} onClick={()=>setTab(id)}><Icon size={14}/>{id==='browser'?'浏览':label}</button>)}</>;
  return (
    <PreviewContext.Provider value={previewContext}>
      <div className="desktop-conversation-body">
      <div className="chat-column desktop-chat-column">
      <header className="chat-header desktop-conversation-heading">
        <div>
          {editingTitle ? (
            <form
              className="desktop-title-form"
              onSubmit={async (event) => {
                event.preventDefault();
                const result = await metadataCommands.execute({title});
                if (result) setEditingTitle(false);
              }}
            >
              <input
                aria-label="会话标题"
                maxLength={120}
                disabled={!online||!canOperate||metadataCommands.busy||!!metadataCommands.failure}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
              <button disabled={!online || !canOperate || !title.trim() || metadataCommands.busy || !!metadataCommands.failure}>保存标题</button>
              <button type="button" onClick={() => setEditingTitle(false)}>
                取消
              </button>
            </form>
          ) : (
            <h1>{session.title}</h1>
          )}
          {metadataCommands.busy&&<p role="status">正在确认会话修改…</p>}
          {metadataCommands.failure&&<div className="desktop-metadata-failure" role="alert"><span>{metadataCommands.failure.body.title!==undefined?`重命名为「${metadataCommands.failure.body.title}」`:metadataCommands.failure.body.archived?'归档会话':'取消归档'}未确认：{metadataCommands.failure.message}</span><button disabled={!online||!canOperate||metadataCommands.busy} onClick={async()=>{const renaming=metadataCommands.failure.body.title!==undefined;if(await metadataCommands.retry()&&renaming)setEditingTitle(false);}}>重试会话修改</button><button disabled={metadataCommands.busy} onClick={metadataCommands.dismiss}>关闭会话修改提示</button></div>}
          <span title={session.workspace}><GitBranch size={12}/>{changeSummary?.branch??session.workspace.split(/[\\/]/).filter(Boolean).at(-1)}<i className="header-divider"/>{name}<i className="online-dot"/>        <span
          className={`desktop-status ${session.status === "requires_action" || session.inputs?.length ? "attention" : ""}`}
        >
          {active ? (
            <LoaderCircle
              size={13}
              className={
                session.status === "requires_action" || session.inputs?.length ? "" : "desktop-spin"
              }
            />
          ) : ["error", "disconnected"].includes(session.status) ? (
            <X size={13} />
          ) : (
            <Check size={13} />
          )}
          {sessionLabel(session)}
        </span></span>
        </div>
          {workbench.persistent && (
            <details className="workbench-tool-menu session-action-menu"><summary className="icon-button" aria-label="会话操作" title="会话操作"><MoreHorizontal size={16}/></summary><div>
              <button aria-label="重命名" title="重命名"
                disabled={!online || !canOperate || metadataCommands.busy || !!metadataCommands.failure}
                onClick={event => {
                  event.currentTarget.closest('details').open=false;
                  setTitle(session.title);
                  setEditingTitle(true);
                }}
              >
                重命名
              </button>
              <button aria-label={session.archived?"取消归档":"归档"} title={session.archived?"取消归档":"归档"}
                disabled={!online || !canOperate || active || metadataCommands.busy || !!metadataCommands.failure}
                onClick={event=>{event.currentTarget.closest('details').open=false;void metadataCommands.execute({archived:!session.archived});}}
              >
                {session.archived?"取消归档":"归档"}
              </button>
              {session.historyOnly&&!session.archived&&canOperate&&!(session.queue??[]).length&&<button disabled={!online||sending} onClick={async event=>{event.currentTarget.closest('details').open=false;setSending(true);await queueCommands.execute({resume:true,freshContext:true});setSending(false);}}>新开 Agent 上下文</button>}
            </div></details>
          )}
      </header>

      <div className="chat-reading desktop-timeline-shell">
      <div
        className="chat-scroll desktop-timeline"
        ref={timeline}
        onScroll={(event) => {
          const element = event.currentTarget;
          const nearBottom =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            56;
          followLatest.current = nearBottom;
          setFollowing(nearBottom);
        }}
      ><div className="conversation">
        {history.enabled&&<div className="desktop-history-controls" aria-label="历史记录">
          {(history.hasMore||!history.ready)&&<button type="button" className="desktop-text-action" disabled={!online||history.busy} onClick={()=>{followLatest.current=false;setFollowing(false);void(history.ready?history.loadOlder():history.retry());}}>{history.busy?'正在读取历史…':history.ready?'加载更早记录':'读取历史记录'}</button>}
          {history.error&&<p role="alert">历史加载失败：{history.error} <button type="button" className="desktop-text-action" disabled={!online||history.busy} onClick={()=>void history.retry()}>重试</button></p>}
          {history.warnings.map(warning=><p key={warning}>{warning}</p>)}
        </div>}
        {!history.enabled&&(session.messages.length>=128||session.tools.length>=100)&&<p className="desktop-history-notice">当前主机仅提供最近记录。请在任务结束后到设置重启主机，以启用完整历史。</p>}
        {!history.session.messages.length && (
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
          <div className="conversation-round desktop-turn" tabIndex={-1} key={turn.id} data-turn-id={turn.id}>
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
          <p className={`desktop-turn-end ${session.stopReason==='end_turn'?'visually-hidden':''}`} role="status">
            {session.stopReason === "cancelled"
              ? "本轮已停止"
              : session.stopReason === "end_turn"
                ? "本轮执行结束"
                : `本轮已结束 · ${session.stopReason}`}
          </p>
        ) : null}
      </div></div>
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
      <div className="composer-area desktop-composer-wrap">
        <div className="composer desktop-composer" onPaste={attachmentDraft.onPaste} onDrop={attachmentDraft.onDrop} onDragOver={attachmentDraft.onDragOver}>
          <AttachmentPicker inputRef={attachmentInput} draft={attachmentDraft} disabled={readOnly||sending} supported={workbench.features?.includes('attachments')}/>
          <Queue
            commands={queueCommands}
            session={session}
            workbench={workbench}
            online={online && canOperate}
          />
          <ComposerInput inputActions={composerActions} session={session} workbench={workbench} value={draft}
            onChange={text=>{setDraft(text);requestKey.current=null;}}
            files={fileReferences} onFiles={changeReferences} onSubmit={()=>void send()}
            onPanel={setTab} disabled={readOnly || sending} online={online}
            placeholder={!canOperate ? "此设备仅可查看或审批，不能发送任务" : readOnly ? "先取消归档后继续会话" : active ? "当前正在执行，发送后加入下一轮队列…" : "描述任务，输入 / 选择指令，@ 引用文件…"}/>
          <div className="composer-toolbar desktop-composer-toolbar"><div>
            <div className="composer-context-control" ref={contextControl}><IconButton label="添加上下文" disabled={readOnly||sending} onClick={()=>setContextMenuOpen(!contextMenuOpen)}><Plus size={19}/></IconButton>{contextMenuOpen&&<div className="composer-context-actions"><button type="button" aria-label="添加附件" disabled={!workbench.features?.includes('attachments')||!online||attachmentDraft.busy} onClick={()=>{setContextMenuOpen(false);attachmentInput.current?.click();}}><Paperclip size={14}/>添加附件</button><button type="button" onClick={()=>{setContextMenuOpen(false);composerActions.current?.trigger('/');}}><Slash size={14}/>选择指令</button><button type="button" onClick={()=>{setContextMenuOpen(false);composerActions.current?.trigger('@');}}><AtSign size={14}/>引用文件</button></div>}</div>
            <button type="button" className="permission" onClick={()=>setTab('agent')}><ShieldCheck size={13}/>会话权限<ChevronDown size={11}/></button>
          </div><div><AgentConfigControls session={session} workbench={workbench} compact label={name} onOpen={()=>setTab('agent')}/>
            <button
              className="send-button desktop-send"
              aria-label="发送消息"
              disabled={
                readOnly ||
                (!draft.trim()&&!fileReferences.length&&!attachmentDraft.items.length) ||
                attachmentDraft.busy ||
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
          </div></div>
        </div>
        {['failed','interrupted'].includes(lastRun?.status)&&(lastRun.text||lastRun.files?.length||lastRun.attachments?.length)&&<button className="desktop-text-action" disabled={readOnly||sending||attachmentDraft.busy} onClick={()=>{setDraft(previous=>previous.trim()?previous+'\n\n'+lastRun.text:lastRun.text);changeReferences([...new Set([...fileReferences,...(lastRun.files??[])])].slice(0,5));attachmentDraft.replace([...new Map([...attachmentDraft.items,...(lastRun.attachments??[])].map(item=>[item.id,item])).values()].slice(0,5));}}>恢复失败任务到输入框（不会自动发送）</button>}
        <div className="composer-caption desktop-composer-footer">
          <span>Enter 发送 · Shift+Enter 换行</span>
          {active ? (
            <button
              disabled={
                !online || !canOperate || session.status === "cancelling"
              }
              onClick={() =>
                void act(stopCurrentRun)
              }
            >
              <Square size={11} />
              {session.status === "cancelling" ? "正在停止" : "停止执行"}
            </button>
          ) : (
            <span>
              {session.historyOnly
                ? "会话已保存到本机"
                : workbench.persistent
                  ? "会话已保存到本机"
                  : "本次主机运行期间保留会话"}
            </span>
          )}
        </div>
      </div>
      </div>
      {tab!=="chat" && <><SplitHandle onResize={width=>{setExpandedPanel(false);setPanelWidth(width);}}/><aside style={expandedPanel?{'--panel-width':'min(70%, 1100px)'}:panelWidth?{'--panel-width':`${panelWidth}px`}:undefined} className={`context-panel desktop-right-panel ${expandedPanel?'expanded-preview':''}`} aria-label="工作区预览"><header className="panel-tabs desktop-right-panel-header">{toolNavigation}<div className="panel-controls"><button className="icon-button desktop-expand-preview" aria-label={expandedPanel?'恢复面板宽度':'扩大预览'} onClick={()=>setExpandedPanel(!expandedPanel)}>{expandedPanel?<Minimize2 size={15}/>:<Maximize2 size={15}/>}</button><button className="icon-button" aria-label="收起右侧面板" onClick={()=>setTab('chat')}><X size={15}/></button></div></header>{tab==='browser'?<BrowserPreview url={browserUrl} onNavigate={openUrl} canBack={browserHistory.index>0} canForward={browserHistory.index<browserHistory.urls.length-1} onBack={()=>setBrowserHistory(previous=>({...previous,index:Math.max(0,previous.index-1)}))} onForward={()=>setBrowserHistory(previous=>({...previous,index:Math.min(previous.urls.length-1,previous.index+1)}))}/>:<SessionTools key={tab} artifactCapture={artifactCapture} session={history.session} workbench={workbench} tab={tab} act={act} fileTarget={fileTarget} onLocateRun={locateRun} availableRunIds={turns.map(turn=>turn.id)}/>}</aside></>}
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
