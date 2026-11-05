// Throwaway prototype: three structural variants, switched via ?variant=.
// All operations below modify in-memory demonstration data only.
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Bell, Check, CheckCheck, ChevronDown, ChevronRight, Circle, CircleCheck, CircleHelp, Code2, Command, FileCode2, Files, Folder, GitBranch, LayoutDashboard, ListFilter, LoaderCircle, MessageSquare, Monitor, Moon, MoreHorizontal, PanelLeft, PanelRight, Plus, RotateCcw, Search, Settings2, ShieldCheck, Smartphone, Square, Sun, Terminal, Unplug, Wifi, WifiOff, X } from 'lucide-react';
import './style.css';
import './theme.css';
import './compact.css';
import brandMark from '../../assets/brand/vibeone-logo-mark.svg';

// Shared system-font lettering and the vector symbol.
function BrandLogo({ variant = 'lockup' }) {
  return <span className={`brand-logo brand-logo-${variant}`} role="img" aria-label="VibeOne">
    {variant !== 'wordmark' && <img className="brand-symbol" src={brandMark} alt="" aria-hidden="true"/>}
    {variant !== 'mark' && <span className="brand-word" aria-hidden="true">VibeOne</span>}
  </span>;
}

const variants = [
  { id: 'focus', name: '聚焦会话', description: '正文优先，上下文按需展开' },
  { id: 'workbench', name: '并列工作台', description: '会话、执行和变更并排检查' },
  { id: 'overview', name: '任务总览', description: '先看全局，再进入单项任务' },
];
const seed = [
  { id: 'filter', title: '为任务列表增加状态筛选', short: '任务状态筛选', agent: 'Claude Code', branch: 'feat/task-filter', state: 'pending', time: '刚刚', project: 'vibeone-app' },
  { id: 'api', title: '梳理 API 错误处理', short: 'API 错误处理', agent: 'Codex', branch: 'fix/api-errors', state: 'running', time: '2 分钟前', project: 'api-service' },
  { id: 'style', title: '统一表单组件的交互状态', short: '表单交互状态', agent: 'Claude Code', branch: 'refactor/form-states', state: 'completed', time: '14:08', project: 'vibeone-app' },
];
const fileData = [
  { name: 'filter.rs', path: 'src/tasks/filter.rs', plus: 24, minus: 3 },
  { name: 'mod.rs', path: 'src/tasks/mod.rs', plus: 8, minus: 2 },
  { name: 'task_filter.rs', path: 'tests/task_filter.rs', plus: 32, minus: 0 },
];
const stateLabels = { pending: '等待审批', running: '运行中', completed: '已完成', cancelled: '已取消', cancelling: '正在停止', rejected: '已拒绝', submitting: '正在提交', sent: '决定已发送', external: '已由其他设备处理', invalidated: '请求已失效', new: '未开始' };
function IconButton({ label, children, ...props }) { return <button className="icon-button" aria-label={label} title={label} {...props}>{children}</button>; }
function Status({ state, compact = false }) {
  const Icon = state === 'pending' ? CircleHelp : state === 'completed' ? CircleCheck : ['cancelling','submitting','running'].includes(state) ? LoaderCircle : state === 'sent' ? CheckCheck : Circle;
  return <span className={`status status-${state} ${compact ? 'compact' : ''}`}><Icon size={13} className={['cancelling','submitting'].includes(state) ? 'spin' : ''} /><span>{stateLabels[state] || state}</span></span>;
}
function App() {
  const params = new URLSearchParams(location.search);
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('vibeone-theme');
      return ['light', 'dark', 'system'].includes(saved) ? saved : 'system';
    } catch { return 'system'; }
  });
  useEffect(() => {
    const system = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved = theme === 'system' ? (system.matches ? 'dark' : 'light') : theme;
      document.documentElement.dataset.theme = resolved;
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#18191b' : '#f3f3f1');
    };
    apply();
    try { localStorage.setItem('vibeone-theme', theme); } catch { /* Session preference still works. */ }
    system.addEventListener('change', apply);
    return () => system.removeEventListener('change', apply);
  }, [theme]);
  const [variant, setVariant] = useState(variants.some(v => v.id === params.get('variant')) ? params.get('variant') : 'focus');
  const [device, setDevice] = useState(params.get('device') === 'mobile' ? 'mobile' : 'desktop');
  const [sessions, setSessions] = useState(seed);
  const [selected, setSelected] = useState('filter');
  const [view, setView] = useState('conversation');
  const [mobilePage, setMobilePage] = useState('list');
  const [connected, setConnected] = useState(true);
  const [approval, setApproval] = useState('pending');
  const [decision, setDecision] = useState('allow');
  const [inspector, setInspector] = useState(null);
  const [fileIndex, setFileIndex] = useState(0);
  const [drafts, setDrafts] = useState({});
  const [messages, setMessages] = useState({});
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [sessionDrawer, setSessionDrawer] = useState(false);
  const timers = useRef([]);
  const runEpoch = useRef({ filter: 0 });
  const online = useRef(connected);
  online.current = connected;
  const current = sessions.find(s => s.id === selected) || sessions[0];
  const pending = approval === 'pending' || approval === 'submitting' ? 1 : 0;
  const activeVariant = variants.find(v => v.id === variant);
  const filtered = sessions.filter(s => (s.title+s.project+s.agent).toLowerCase().includes(query.toLowerCase()) && (filter !== 'pending' || (s.id === 'filter' && pending)));
  const later = (fn, delay) => { timers.current.push(setTimeout(fn, delay)); };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const timeline = document.querySelector('.timeline');
      if (timeline) timeline.scrollTo({ top: timeline.scrollHeight, behavior: 'instant' });
    });
    return () => cancelAnimationFrame(frame);
  }, [selected, view, variant, mobilePage]);
  useEffect(() => {
    const handler = e => {
      if (e.key === 'Escape') { setInspector(false); setSessionDrawer(false); if (view === 'approval') setView('conversation'); }
      if (!['ArrowLeft','ArrowRight'].includes(e.key) || e.target.closest('input,textarea,[contenteditable]')) return;
      if (!e.altKey) return;
      const next = variants[(variants.findIndex(v => v.id === variant)+(e.key === 'ArrowRight'?1:2))%3]; chooseVariant(next.id);
    };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  }, [variant]);
  function urlState(key, value) { const url = new URL(location.href); url.searchParams.set(key, value); history.replaceState(null, '', url); }
  function chooseVariant(id) { setVariant(id); urlState('variant', id); setOverviewOpen(false); setInspector(null); }
  function chooseDevice(value) { setDevice(value); urlState('device', value); setInspector(false); }
  function selectSession(id) { setSelected(id); setView('conversation'); setMobilePage('detail'); setOverviewOpen(true); setInspector(false); setSessionDrawer(false); }
  function updateState(id, state) { setSessions(list => list.map(s => s.id === id ? {...s, state} : s)); }
  function toast(text) { setNotice(text); later(() => setNotice(''), 3800); }
  function decide(value) {
    if (!online.current || approval !== 'pending' || sessions.find(s=>s.id==='filter')?.state!=='pending') return;
    const epoch=runEpoch.current.filter;
    setDecision(value); setApproval('submitting');
    later(() => {
      if (runEpoch.current.filter!==epoch) return;
      if (!online.current) { setApproval('pending'); toast('连接已断开，本次决定尚未提交。重连后可重试。'); return; }
      setApproval('sent'); updateState('filter', value === 'allow' ? 'running' : 'rejected');
      later(() => { if(runEpoch.current.filter!==epoch)return; setApproval(value === 'allow' ? 'completed' : 'rejected'); if(value === 'allow') updateState('filter','completed'); }, 2300);
    }, 1000);
  }
  function reset() {
    timers.current.forEach(clearTimeout); timers.current=[];
    runEpoch.current.filter+=1;
    setSessions(seed); setApproval('pending'); setConnected(true); setDecision('allow'); setDrafts({}); setMessages({}); setNotice('');
  }
  function cancelRun() {
    if (!connected || ['completed','cancelled','cancelling','rejected','new'].includes(current.state)) return;
    const id=current.id; updateState(id,'cancelling');
    runEpoch.current[id]=(runEpoch.current[id]||0)+1;
    if(id==='filter')setApproval('invalidated');
    later(() => { if (!online.current) { toast('停止结果尚未确认，请重连后查看。'); return; } updateState(id,'cancelled'); if(id==='filter') setApproval('cancelled'); }, 1300);
  }
  function otherDevice() {
    if (!connected || approval !== 'pending') return;
    runEpoch.current.filter+=1;
    setApproval('external'); toast('模拟：已由桌面设备拒绝该请求。');
    updateState('filter','rejected');
  }
  function send(e) {
    e.preventDefault(); const text=(drafts[selected]||'').trim(); if (!text || !connected) return;
    setMessages(m=>({...m,[selected]:[...(m[selected]||[]),{text,queued:current.state==='pending'}]}));
    setDrafts(d=>({...d,[selected]:''}));
    toast(current.state==='pending'?'任务已加入下一轮队列（模拟）':'消息已发送（模拟）');
  }
  function newSession() {
    const id='new-'+Date.now(); setSessions(s=>[{id,title:'新会话',short:'新会话',agent:'Claude Code',branch:'main',state:'new',project:'vibeone-app',time:'刚刚'},...s]); selectSession(id);
  }
  const showApproval = () => { setSelected('filter'); setView('approval'); setMobilePage('approval'); setOverviewOpen(true); setInspector(false); };
  function Navigation() {
    return <aside className="navigation"><a className="brand" href="?variant=focus" aria-label="VibeOne 工作台"><BrandLogo/></a>
      <div className="nav-links"><button className={view!=='approval'?'nav-item selected':'nav-item'} onClick={()=>{setView('conversation');setOverviewOpen(false);setMobilePage('list');}}><LayoutDashboard size={18}/>工作台</button><button className={view==='approval'?'nav-item selected':'nav-item'} onClick={showApproval}><ShieldCheck size={18}/>待处理{pending>0&&<span className="count">{pending}</span>}</button></div>
      <div className="workspace-caption">工作区<IconButton label="添加演示会话" onClick={newSession}><Plus size={15}/></IconButton></div>
      <button className="workspace chosen" onClick={()=>{setQuery('vibeone-app');setMobilePage('list');setOverviewOpen(false);}}><Folder size={16}/><span>vibeone-app</span><span className="tiny-dot"/></button>
      <button className="workspace" onClick={()=>{setQuery('api-service');setMobilePage('list');setOverviewOpen(false);}}><Folder size={16}/><span>api-service</span></button>
      <button className="workspace all-workspaces" onClick={()=>setQuery('')}>查看全部工作区<ArrowRight size={14}/></button>
      {variant==='focus'&&<div className="focus-sessions"><div className="focus-project"><Folder size={16}/><span>vibeone-app</span><ChevronDown size={14}/></div>{SessionList()}</div>}
      <div className="nav-bottom"><div className="host-mini"><span className={`host-light ${!connected?'off':''}`}/><div><strong>工作主机</strong><span>{connected?'本机 · 已连接':'离线 · 最后同步 14:32'}</span></div><Monitor size={17}/></div><p>本地运行，随处接续。</p></div>
    </aside>;
  }
  function SessionList() {
    return <section className="session-column"><div className="session-heading"><h2>会话</h2><IconButton label="新建会话" onClick={newSession}><Plus size={18}/></IconButton></div>
      <label className="search-box"><Search size={15}/><input aria-label="搜索会话" placeholder="搜索会话或工作区" value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<IconButton label="清除搜索" onClick={()=>setQuery('')}><X size={13}/></IconButton>}</label>
      <div className="list-heading"><span>今天</span><span>{filtered.length} 个会话</span></div>
      <div className="session-items">{filtered.map(s=><button key={s.id} onClick={()=>selectSession(s.id)} className={`session-row ${selected===s.id?'active':''}`}><span className="session-row-title">{s.title}</span><span className="session-row-meta">{s.agent}<span>{s.time}</span></span><Status state={s.state} compact/></button>)}{!filtered.length&&<div className="empty-small">没有匹配的会话<button className="text-button" onClick={()=>setQuery('')}>清除搜索</button></div>}</div>
      <div className="session-foot"><GitBranch size={14}/>每个任务，保留完整上下文。</div>
    </section>;
  }
  function Header() {
    return <header className="conversation-header"><div className="header-title"><button className="back-button" aria-label="返回会话列表" onClick={()=>{setMobilePage('list');setOverviewOpen(false);}}><ArrowLeft size={19}/></button><div><h1>{view==='approval'?'审批详情':current.title}</h1><div className="breadcrumbs"><span>{view==='approval'?'vibeone-app':current.project}</span><span className="breadcrumb-separator">/</span><GitBranch size={12}/><span>{view==='approval'?'feat/task-filter':current.branch}</span></div></div></div>
      <div className="header-actions"><button className="icon-button session-toggle" aria-label="切换会话" aria-expanded={sessionDrawer} onClick={()=>setSessionDrawer(v=>!v)}><PanelLeft size={18}/></button><Status state={view==='approval'?approval:current.state}/><IconButton label={inspector?'收起变更':'查看工作区变更'} onClick={()=>setInspector(v=>!v)}><PanelRight size={18}/></IconButton></div></header>;
  }
  function Approval({ full=false }) {
    const done=!['pending','submitting'].includes(approval);
    const title=approval==='submitting'?'正在提交你的决定':approval==='sent'?'决定已发送':approval==='completed'?'工具执行已完成':approval==='rejected'?'已拒绝这次调用':approval==='external'?'已由其他设备处理':approval==='cancelled'?'任务已取消，请求已失效':approval==='invalidated'?'任务正在停止，请求已失效':'运行测试需要你的批准';
    return <section className={`approval ${full?'approval-full':''} ${done?'resolved':''}`} aria-label="工具权限请求"><div className="approval-top"><span className="approval-symbol">{done?<Check size={18}/>:<ShieldCheck size={19}/>}</span><div><h2>{title}</h2><p>{done?'当前审批记录已更新':'Claude Code 请求执行一条终端命令'}</p></div>{!full&&<button className="text-button approval-detail" onClick={showApproval}>查看详情<ArrowRight size={13}/></button>}</div>
      {full&&<div className="approval-context"><span>所属会话</span><strong>为任务列表增加状态筛选</strong><span>工作区与分支</span><strong>vibeone-app <span className="slash">/</span> feat/task-filter</strong><span>请求时间</span><strong>今天 14:32 · 演示请求 RQ-008</strong></div>}
      <div className="command-block"><div className="command-label"><Terminal size={13}/>终端命令<span>原始动作</span></div><pre><code>cargo test -p task-service</code></pre></div>
      <div className="approval-scope"><span>影响范围</span><strong>当前工作区 · 本次工具调用</strong></div>
      {full&&<div className="reason"><h3>为什么要运行？</h3><p>验证新增的状态筛选逻辑，并检查现有任务列表行为是否受到影响。</p><p className="muted">命令与选项由 Agent 提供。允许一次不会改变后续审批设置。</p></div>}
      <div className="approval-feedback" aria-live="polite">{!connected?'主机已离线。重连并确认请求有效后，才能提交决定。':approval==='submitting'?'正在等待主机确认，请勿重复提交。':approval==='sent'?'决定已记录并发送，正在等待工具后续结果。':approval==='completed'?'模拟执行结束：12 项测试通过。':approval==='rejected'?'已将拒绝决定发送给 Agent，工具没有继续执行。':approval==='external'?'此请求已由桌面设备拒绝，不需要重复操作。':approval==='cancelled'?'原任务已停止，此请求不再接受决定。':approval==='invalidated'?'正在等待任务停止确认，此请求不再接受审批。':full?'主机在线 · 提交前会再次校验请求状态。':''}</div>
      {!done&&<div className="approval-actions"><span className="once-hint">仅对这次调用生效</span><button className="button" onClick={()=>decide('reject')} disabled={!connected||approval==='submitting'}>拒绝</button><button className="button primary" onClick={()=>decide('allow')} disabled={!connected||approval==='submitting'}>{approval==='submitting'?<LoaderCircle size={16} className="spin"/>:<Check size={16}/>}允许一次</button></div>}
      {full&&done&&<button className="button primary return-conversation" onClick={()=>{setView('conversation');setMobilePage('detail');}}>返回当前会话<ArrowRight size={16}/></button>}
    </section>;
  }
  function Conversation() {
    const isMain=current.id==='filter';
    return <><div className="timeline" key={current.id}>
      {current.state==='new'?<div className="new-conversation"><MessageSquare size={30}/><h2>从一个具体任务开始</h2><p>描述你想完成的工作，Agent 的执行过程和需要你处理的决定会出现在这里。</p></div>:<>
      <div className="day-divider"><span>今天 · 演示会话</span></div><article className="user-message"><span className="avatar user-avatar">你</span><div><div className="message-byline"><strong>你</strong><time>14:28</time></div><p>{isMain?'为任务列表增加状态筛选，支持全部、进行中和已完成。保留现有交互，并补充测试。':current.id==='api'?'检查 API 层的错误处理，统一错误返回并保留可诊断信息。':'统一表单组件的焦点、禁用和错误状态，并验证键盘操作。'}</p></div></article>
      <article className="agent-message"><span className="avatar agent-avatar"><Command size={16}/></span><div className="message-body"><div className="message-byline"><strong>{current.agent}</strong><span className="agent-role">Agent</span><time>14:29</time></div><p>{isMain?'我会先查看任务列表和现有测试，沿用组件的交互方式，再补充筛选逻辑。':'已完成相关代码检查，正在按任务范围处理。执行记录会持续保留。'}</p>
      <div className="plan-list"><div><CircleCheck size={15}/><span>检查现有结构与行为</span></div><div><CircleCheck size={15}/><span>{isMain?'增加筛选逻辑与边界用例':'整理修改并检查影响范围'}</span></div><div className={current.state==='completed'?'':'plan-pending'}>{current.state==='completed'?<CircleCheck size={15}/>:<Circle size={15}/>}<span>运行测试并检查差异</span></div></div>
      <details className="tool-call"><summary><FileCode2 size={15}/><span>读取 {isMain?'任务列表组件':'相关源文件'}</span><span className="tool-complete">已完成</span><ChevronDown size={14}/></summary><div className="tool-body"><code>{isMain?'src/tasks/filter.rs':'src/api/errors.rs'}</code><p>已读取源文件及关联测试。此记录为原型演示数据。</p></div></details>
      {isMain?Approval({}):<div className="activity-line"><Activity size={15}/><span>{current.state==='completed'?'任务执行已完成，请检查工作区变更。':current.state==='cancelled'?'任务已停止，历史记录已保留。':current.state==='cancelling'?'正在停止任务，等待进程退出。':'正在处理错误映射与测试用例…'}</span></div>}
      {isMain&&approval==='completed'&&<div className="completion"><CircleCheck size={17}/><div><strong>12 项测试通过</strong><p>状态筛选已完成，3 个文件有变更。请检查差异后再决定是否合并。</p></div></div>}
      </div></article></>}
      {(messages[selected]||[]).map((m,i)=><article className="user-message" key={i}><span className="avatar user-avatar">你</span><div><div className="message-byline"><strong>你</strong><span>{m.queued?'已排队 · 下一轮':'刚刚'}</span></div><p>{m.text}</p></div></article>)}
      </div><div className="composer-area"><form onSubmit={send} className="composer"><textarea aria-label="任务输入" placeholder={connected?'补充任务或发送新的指令…':'离线时可以继续编辑草稿…'} rows={2} value={drafts[selected]||''} onChange={e=>setDrafts(d=>({...d,[selected]:e.target.value}))} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();send(e);}}}/><div className="composer-controls"><span className="composer-agent"><Command size={14}/>{current.agent}<span className="small-separator"/>当前工作区</span><button className="send-button" aria-label={current.state==='pending'?'加入下一轮队列':'发送任务'} disabled={!connected||!(drafts[selected]||'').trim()}><ArrowUp size={18}/></button></div></form><div className="composer-note"><span>{!connected?'草稿保留在当前页面，尚未发送。':current.state==='pending'?'等待审批期间，新消息将排队到下一轮。':'Enter 发送 · Shift + Enter 换行'}</span>{!['completed','cancelled','rejected','new'].includes(current.state)&&<button className="stop-button" onClick={cancelRun} disabled={!connected||current.state==='cancelling'}><Square size={10}/>{current.state==='cancelling'?'正在停止':'停止任务'}</button>}</div></div></>;
  }
  function Inspector() {
    return <aside className={`inspector ${inspector?'is-open':''}`} aria-label="工作区变更"><div className="inspector-heading"><h2>工作区变更 <span>3</span></h2><IconButton label="关闭变更面板" onClick={()=>setInspector(false)}><X size={17}/></IconButton></div><p className="inspector-description">最近采集 14:32 · 演示快照</p><div className="change-summary"><span>3 个文件</span><span><b>+64</b> <i>−5</i></span></div><div className="file-list">{fileData.map((f,i)=><button key={f.path} className={fileIndex===i?'selected-file':''} onClick={()=>setFileIndex(i)}><FileCode2 size={14}/><span>{f.path}</span><b>+{f.plus}</b></button>)}</div><div className="diff-title"><span>{fileData[fileIndex].name}</span><span>统一视图</span></div><div className="diff-code"><div className="code-line context"><span>18</span><code>pub fn filter_tasks(</code></div><div className="code-line context"><span>19</span><code>  tasks: &amp;[Task],</code></div><div className="code-line add"><span>20</span><code>+ status: TaskStatus,</code></div><div className="code-line context"><span>21</span><code>) -&gt; Vec&lt;&amp;Task&gt; {'{'}</code></div><div className="code-line remove"><span>22</span><code>− tasks.iter().collect()</code></div><div className="code-line add"><span>22</span><code>+ tasks.iter()</code></div><div className="code-line add"><span>23</span><code>+   .filter(matches_status)</code></div><div className="code-line add"><span>24</span><code>+   .collect()</code></div><div className="code-line context"><span>25</span><code>{'}'}</code></div></div><div className="inspector-note"><CircleHelp size={15}/><p>这里展示工作区当前差异，可能包含其他修改。执行完成后仍需人工检查。</p></div></aside>;
  }
  function Overview() {
    return <section className="overview"><div className="overview-heading"><div><h1>会话</h1><p>查看运行进度和待处理的审批。</p></div><button className="button primary" onClick={newSession}><Plus size={16}/>新建会话</button></div><button className={`attention-strip ${!pending?'attention-done':''}`} onClick={showApproval}><span className="attention-icon"><ShieldCheck size={22}/></span><span><strong>{pending?'有 1 项操作等待你的批准':'所有待处理事项已更新'}</strong><span>{pending?'任务状态筛选 · Claude Code 申请运行测试':'查看最新决定与会话进展'}</span></span><span className="attention-link">查看审批<ArrowRight size={16}/></span></button><div className="overview-list-top"><div className="segmented"><button className={filter==='all'?'active':''} onClick={()=>setFilter('all')}>全部会话 <span>{sessions.length}</span></button><button className={filter==='pending'?'active':''} onClick={()=>setFilter('pending')}>需要处理 <span>{pending}</span></button></div><label className="search-box"><Search size={15}/><input aria-label="搜索总览会话" placeholder="搜索会话" value={query} onChange={e=>setQuery(e.target.value)}/></label></div><div className="task-table"><div className="task-table-head"><span>任务</span><span>工作区 / Agent</span><span>状态</span><span>最近活动</span><span/></div>{filtered.map(s=><button className="task-table-row" key={s.id} onClick={()=>selectSession(s.id)}><span className="task-cell"><span className="task-icon"><MessageSquare size={18}/></span><span><strong>{s.title}</strong><span><GitBranch size={12}/>{s.branch}</span></span></span><span className="task-agent"><strong>{s.project}</strong><span>{s.agent}</span></span><Status state={s.state}/><span className="task-time">{s.time}</span><ChevronRight size={17}/></button>)}{!filtered.length&&<div className="empty-small">没有匹配的任务。</div>}</div><div className="overview-bottom"><Monitor size={17}/><span>任务运行在工作主机上，关闭此页面不会停止 Agent。</span></div></section>;
  }
  function MobileNav() { return <nav className="mobile-nav" aria-label="手机导航"><button className={mobilePage==='host'?'active':''} onClick={()=>setMobilePage('host')}><Monitor size={20}/>主机</button><button className={['detail','list'].includes(mobilePage)?'active':''} onClick={()=>{setMobilePage('list');setView('conversation');}}><MessageSquare size={20}/>会话</button><button className={mobilePage==='approval'?'active':''} onClick={showApproval}><span className="nav-icon-count"><ShieldCheck size={20}/>{pending>0&&<b>{pending}</b>}</span>审批</button><button className={mobilePage==='settings'?'active':''} onClick={()=>setMobilePage('settings')}><Settings2 size={20}/>设置</button></nav>; }
  return <div className={`prototype-page ${device==='mobile'?'mobile-preview':''}`}>
    <div className="prototype-heading"><div><BrandLogo variant="wordmark"/><BrandLogo variant="mark"/><span>交互设计原型 · 模拟数据</span></div><div className="preview-controls"><label className="theme-control">{theme==='system'?<Monitor size={15}/>:theme==='dark'?<Moon size={15}/>:<Sun size={15}/>}<select aria-label="外观主题" value={theme} onChange={e=>setTheme(e.target.value)}><option value="system">跟随系统</option><option value="light">亮色</option><option value="dark">暗色</option></select></label><div className="device-switch" aria-label="预览设备"><button className={device==='desktop'?'active':''} onClick={()=>chooseDevice('desktop')}><Monitor size={15}/>桌面</button><button className={device==='mobile'?'active':''} onClick={()=>chooseDevice('mobile')}><Smartphone size={15}/>手机</button></div></div></div>
    <div className={`app-shell variant-${variant} mobile-page-${mobilePage} ${view==='approval'?'view-approval':''} ${overviewOpen?'overview-open':''} ${sessionDrawer?'show-sessions':''}`}>
      {Navigation()}{variant==='workbench'&&SessionList()}
      <main className="main-stage"><div className={`connection-bar ${!connected?'disconnected':''}`}><div>{connected?<span className="host-light"/>:<WifiOff size={13}/>}<span>{connected?'工作主机':'主机已离线'}</span><span className="connection-detail">{connected?'本机 · 已连接':'最后同步 14:32 · 当前为只读快照'}</span></div>{!connected?<button onClick={()=>{setConnected(true);toast('已重连，当前请求状态已重新校验（模拟）');}}>重新连接<RotateCcw size={12}/></button>:<span className="local-label"><ShieldCheck size={12}/>本地运行</span>}</div>
      <div className="mobile-list"><div className="mobile-list-heading"><div><h1>会话</h1><p>最近会话与待处理事项</p></div><IconButton label="新建手机会话" onClick={newSession}><Plus size={21}/></IconButton></div>{pending>0&&<button className="mobile-attention" onClick={showApproval}><ShieldCheck size={18}/><span>1 项操作需要你的批准</span><ChevronRight size={16}/></button>}{SessionList()}</div>
      <div className="mobile-utility"><h1>{mobilePage==='host'?'工作主机':'原型设置'}</h1>{mobilePage==='host'?<><Monitor size={40}/><h2>{connected?'工作主机已连接':'工作主机已离线'}</h2><p>任务由桌面上的 Host 执行。此原型仅模拟运行状态。</p><button className="button" onClick={()=>setConnected(v=>!v)}>{connected?'模拟断开连接':'模拟重新连接'}</button></>:<><p>使用页面下方的原型工具条切换布局、模拟离线和重置状态。</p><button className="button" onClick={reset}><RotateCcw size={15}/>重置演示数据</button></>}</div>
      {variant==='overview'&&!overviewOpen&&view!=='approval'?Overview():<div className="conversation-layout"><section className="conversation">{Header()}{view==='approval'?<div className="approval-page"><button className="return-link" onClick={()=>{setView('conversation');setMobilePage('detail');}}><ArrowLeft size={15}/>返回当前会话</button>{Approval({full:true})}</div>:Conversation()}</section>{((variant==='workbench'&&inspector!==false)||inspector===true)&&Inspector()}</div>}
      </main>
      {MobileNav()}{inspector&&<button className="drawer-backdrop" aria-label="关闭变更抽屉" onClick={()=>setInspector(false)}/>}
    </div>
    <div className="prototype-toolbar" aria-label="原型演示工具"><div className="variant-control"><IconButton label="上一个布局" onClick={()=>chooseVariant(variants[(variants.findIndex(v=>v.id===variant)+2)%3].id)}><ArrowLeft size={15}/></IconButton><div><label htmlFor="variant-select">布局方案</label><select id="variant-select" value={variant} onChange={e=>chooseVariant(e.target.value)}>{variants.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></div><IconButton label="下一个布局" onClick={()=>chooseVariant(variants[(variants.findIndex(v=>v.id===variant)+1)%3].id)}><ArrowRight size={15}/></IconButton></div><span className="variant-description">{activeVariant.description}</span><div className="simulation-controls"><button className={!connected?'simulation-active':''} onClick={()=>setConnected(v=>!v)}>{connected?<Unplug size={14}/>:<Wifi size={14}/>}<span>{connected?'模拟离线':'恢复连接'}</span></button><button onClick={otherDevice} disabled={!connected||approval!=='pending'}><Monitor size={14}/><span>其他设备处理</span></button><button onClick={reset}><RotateCcw size={14}/><span>重置</span></button></div></div>
    {notice&&<div className="toast" role="status"><CircleCheck size={17}/>{notice}</div>}
  </div>;
}

createRoot(document.getElementById('root')).render(<App/>);
