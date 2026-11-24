import React, {
  memo,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  BookOpen,
  Brain,
  Check,
  Copy,
  ExternalLink,
  FileText,
  Search,
  Terminal,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { AttachmentCards, type AttachmentItem } from "./Attachments.tsx";
import {
  activityTail,
  formatDuration,
  groupProcess,
  toolFamily,
  type ProcessGroupItem,
  type TimelineActivityEvent,
  type TimelineMessage,
  type TimelineTool,
  type TimelineTurn,
} from "./chat-timeline.ts";
import { TurnChangesCard } from "./components/ai/confirmation.tsx";
import { ReasoningActivityShell } from "./components/ai/reasoning.tsx";
import { ToolCallItem, ToolGroupCard } from "./components/ai/tool-card.tsx";
import { remarkSoftBreaks } from "./markdown-layout.ts";
import { workspacePath } from "./preview-links.ts";
import { PreviewContext, PreviewLink, markdownLink } from "./PreviewLinks.tsx";
import { describeAction, describeTool } from "./tool-presentation.ts";
import { ToolDetails } from "./ToolDetails.tsx";

const markdownComponents: Components = {
  a: PreviewLink,
  img: (props) => <span>[图片：{props.alt ?? "图片"}]</span>,
};

const MarkdownBody = memo(function MarkdownBody({
  text,
}: {
  text?: string;
}) {
  return (
    <div className="assistant-message desktop-message-text">
      <ReactMarkdown
        urlTransform={markdownLink}
        remarkPlugins={[remarkGfm, remarkSoftBreaks]}
        components={markdownComponents}
      >
        {text || "…"}
      </ReactMarkdown>
    </div>
  );
});

function Truncated({ item }: { item?: { textTruncated?: boolean } | null }) {
  return item?.textTruncated ? (
    <p className="desktop-history-notice">
      此条正文超过显示上限，仅保留前 65,536 个字符。
    </p>
  ) : null;
}

export const ChatMessage = memo(
  function ChatMessage({
    message,
  }: {
    message: TimelineMessage & {
      attachments?: AttachmentItem[];
      pending?: boolean;
    };
    name?: string;
  }) {
    const user = message.role === "user";
    return user ? (
      <article
        className="user-message desktop-message user"
        data-history-order={message.historyOrder}
      >
        <AttachmentCards items={message.attachments} />
        {(message.text || !message.attachments?.length) && (
          <p className="desktop-message-text">{message.text || "…"}</p>
        )}
        {message.pending && (
          <small className="mt-1.5 block text-[11px] text-[var(--muted)]">
            已受理 · 等待 Agent 接受
          </small>
        )}
        <Truncated item={message} />
      </article>
    ) : (
      <article
        className={`desktop-message ${message.role}`}
        data-history-order={message.historyOrder}
      >
        <MarkdownBody text={message.text} />
        <Truncated item={message} />
      </article>
    );
  },
  (a, b) =>
    a.name === b.name &&
    a.message.id === b.message.id &&
    a.message.text === b.message.text &&
    a.message.attachments === b.message.attachments &&
    a.message.pending === b.message.pending &&
    a.message.role === b.message.role &&
    a.message.historyOrder === b.message.historyOrder &&
    a.message.textTruncated === b.message.textTruncated,
);

const toolStatus: Record<string, string> = {
  pending: "等待执行",
  in_progress: "执行中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已停止",
};

const typeLabel: Record<string, string> = {
  thought: "思考摘要",
  tool: "工具",
  note: "说明",
};

const familyLabel: Record<string, string> = {
  read: "读取文件",
  web: "搜索与浏览网页",
  command: "运行命令",
  file: "文件操作",
  other: "工具调用",
};

const familyIcon: Record<string, LucideIcon> = {
  read: BookOpen,
  web: Search,
  command: Terminal,
  file: FileText,
  other: Wrench,
};

function toolTitle(tool: TimelineTool): string {
  const action = describeAction(tool);
  if (action.label && action.paths.length) {
    return `${action.label} ${action.paths.map((p) => p.split(/[\\/]/).at(-1)).join("、")}`;
  }
  const { kind, fields } = describeTool(tool);
  const value = fields[0]?.value;
  if (kind === "search" && Array.isArray(value)) {
    return `搜索：${value.join("、")}`;
  }
  if (kind === "web" && typeof value === "string") {
    return `${fields.some((field) => field.label === "查找内容") ? "查找网页" : "打开网页"}：${value}`;
  }
  if (kind === "command" && typeof value === "string") {
    return `运行：${value.split("\n")[0]}`;
  }
  if (kind === "file" && typeof value === "string") {
    return `文件：${value}`;
  }
  return tool.title ?? tool.name ?? "工具调用";
}

function ActivityItem({
  activity,
  onInspect,
}: {
  activity: TimelineActivityEvent;
  onInspect: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { item, type, text } = activity;
  const toolItem = item as TimelineTool;
  const Icon =
    type === "thought"
      ? Brain
      : (familyIcon[toolFamily(toolItem)] ?? Wrench);

  const label =
    type === "tool"
      ? ((toolItem.status ? toolStatus[toolItem.status] : undefined) ??
        toolItem.status ??
        "处理中")
      : "思考摘要";

  return (
    <ToolCallItem
      kind={type}
      icon={Icon}
      title={type === "tool" ? toolTitle(toolItem) : activityTail(text)}
      tooltip={
        type === "tool"
          ? describeAction(toolItem).paths.join("\n") || toolTitle(toolItem)
          : undefined
      }
      status={type === "tool" ? toolItem.status : undefined}
      statusLabel={label}
      historyOrder={item.historyOrder}
      open={open}
      onToggle={(isOpen) => {
        setOpen(isOpen);
        if (isOpen) {
          onInspect();
        }
      }}
    >
      {open &&
        (type === "tool" ? (
          <ToolDetails tool={toolItem} />
        ) : (
          <div className="desktop-process-thought">
            <MarkdownBody text={text} />
            <Truncated item={item as { textTruncated?: boolean }} />
          </div>
        ))}
    </ToolCallItem>
  );
}

function ReadFiles({
  activity,
  onInspect,
}: {
  activity: TimelineActivityEvent;
  onInspect: () => void;
}) {
  const preview = useContext(PreviewContext);
  const item = activity.item as TimelineTool;
  const action = describeAction(item);
  if (
    !action.paths.length ||
    ["failed", "cancelled"].includes(item.status ?? "")
  ) {
    return <ActivityItem activity={activity} onInspect={onInspect} />;
  }
  return (
    <div
      className="desktop-read-files flex flex-col gap-1"
      data-history-order={item.historyOrder}
    >
      {action.paths.map((filePath) => {
        const relative = workspacePath(filePath, preview?.workspace);
        const name = filePath.split(/[\\/]/).at(-1);
        return (
          <button
            key={filePath}
            className="event-file inline-flex items-center gap-2 rounded-md px-2 py-1 text-[12px] text-[var(--ink-secondary)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--fg)] disabled:opacity-50"
            title={
              relative
                ? filePath
                : `${filePath} · 不在当前工作区，无法预览`
            }
            disabled={!relative || !preview}
            onClick={() => {
              onInspect();
              if (relative) {
                preview?.openFile(relative);
              }
            }}
          >
            <BookOpen size={13} className="shrink-0 text-[var(--accent)]" />
            <span>{action.label}</span>
            <span className="min-w-0 truncate font-mono text-[var(--fg)]">
              {name}
            </span>
            <ExternalLink size={12} className="shrink-0 opacity-60" />
          </button>
        );
      })}
    </div>
  );
}

function ToolGroup({
  group,
  onInspect,
}: {
  group: Extract<ProcessGroupItem, { type: "tools" }>;
  onInspect: () => void;
}) {
  const Icon = familyIcon[group.family] ?? Wrench;
  const failed = group.items.some(
    (activity) => (activity.item as TimelineTool).status === "failed",
  );
  const working = group.items.some((activity) =>
    ["pending", "in_progress"].includes(
      (activity.item as TimelineTool).status ?? "",
    ),
  );
  const completed = group.items.every(
    (activity) => (activity.item as TimelineTool).status === "completed",
  );
  const count = new Set(
    group.items.flatMap(
      (activity) => describeAction(activity.item as TimelineTool).paths,
    ),
  ).size;
  const completedLabels: Record<string, string | undefined> = {
    read: count ? `已读取 ${count} 个文件` : "已读取文件",
    command: "已运行命令",
    file: "已处理文件",
    web: "已搜索与浏览网页",
  };
  const label = completed
    ? (completedLabels[group.family] ?? familyLabel[group.family])
    : familyLabel[group.family];

  return (
    <ToolGroupCard
      icon={Icon}
      label={label}
      failed={failed}
      working={working}
      bodyClassName={
        group.family === "read" ? "event-files" : "desktop-tool-group-body"
      }
      historyOrder={group.items[0]?.item.historyOrder}
      onOpen={onInspect}
    >
      {group.items.map((activity) =>
        group.family === "read" ? (
          <ReadFiles
            key={activity.id}
            activity={activity}
            onInspect={onInspect}
          />
        ) : (
          <ActivityItem
            key={activity.id}
            activity={activity}
            onInspect={onInspect}
          />
        ),
      )}
    </ToolGroupCard>
  );
}

function useVisibleMotion(
  ref: React.RefObject<HTMLElement | null>,
  enabled: boolean,
): boolean {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    if (!enabled) {
      return;
    }
    let visible = typeof IntersectionObserver === "undefined";
    let disposed = false;
    const update = () => {
      if (!disposed) {
        setAllowed(visible && document.visibilityState !== "hidden");
      }
    };
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver((entries) => {
            visible = entries.some((entry) => entry.isIntersecting);
            update();
          });
    if (ref.current) {
      observer?.observe(ref.current);
    }
    document.addEventListener("visibilitychange", update);
    update();
    return () => {
      disposed = true;
      observer?.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, [enabled, ref]);
  return enabled && allowed;
}

export function ActivityFeed({
  turn,
  status,
  hasInput,
  onReadHistory,
}: {
  turn: TimelineTurn;
  status: string;
  hasInput: boolean;
  onReadHistory: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [tick, setTick] = useState(Date.now);
  const [mountedAt] = useState(Date.now);
  const motionTarget = useRef<HTMLSpanElement | null>(null);
  const { activity, live = false, run } = turn;
  const motion = useVisibleMotion(
    motionTarget,
    live && !["requires_action", "cancelling"].includes(status),
  );
  const groups = useMemo(() => groupProcess(activity), [activity]);

  useEffect(() => {
    if (!live) {
      return;
    }
    setTick(Date.now());
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live]);

  if (!activity.length && !live && !run?.finishedAt) {
    return null;
  }

  const preview = [...activity]
    .sort(
      (a, b) =>
        ((a.item.updatedOrder as number | undefined) ??
          a.item.activityOrder ??
          0) -
        ((b.item.updatedOrder as number | undefined) ??
          b.item.activityOrder ??
          0),
    )
    .slice(-3);
  const last = preview.at(-1);
  const runningLabel =
    last?.type === "thought"
      ? "思考中"
      : last?.type === "tool" &&
          ["in_progress", "pending"].includes(
            (last.item as TimelineTool).status ?? "",
          )
        ? "正在执行"
        : turn.answer?.text
          ? "正在回复"
          : "正在处理";
  const liveLabels: Record<string, string> = {
    starting: "正在准备",
    requires_action: hasInput ? "等待补充信息" : "等待审批",
    cancelling: "正在停止",
  };
  const finishedLabels: Record<string, string> = {
    completed: "已处理",
    cancelled: "已停止",
    failed: "处理未完成",
    interrupted: "已中断",
  };
  const label =
    turn.id === "legacy-tools"
      ? "早期工具记录（轮次未知）"
      : live
        ? (liveLabels[status] ?? runningLabel)
        : ((run?.status ? finishedLabels[run.status] : undefined) ?? "处理记录");
  const elapsed = Math.max(
    0,
    Math.floor(
      ((live ? tick : (run?.finishedAt ?? tick)) -
        (run?.startedAt ?? mountedAt)) /
        1000,
    ),
  );
  const latestThought = preview.findLast((item) => item.type === "thought")?.id;

  return (
    <ReasoningActivityShell
      live={live}
      expanded={expanded}
      hasActivity={activity.length > 0}
      label={label}
      elapsedText={live || run?.finishedAt ? formatDuration(elapsed) : undefined}
      motion={motion}
      motionTargetRef={motionTarget}
      onToggle={
        activity.length
          ? () => {
              setExpanded((value) => !value);
              if (!expanded) {
                onReadHistory();
              }
            }
          : undefined
      }
      preview={
        <div
          className="desktop-activity-preview mt-1.5 space-y-1 border-t border-[var(--line)] pt-2"
          aria-label="最新处理动态"
        >
          {preview.map((item) => {
            const toolItem = item.item as TimelineTool;
            return (
              <div
                key={item.id}
                className={`desktop-activity-preview-row ${item.type}`}
              >
                <span className="rounded bg-[var(--hover)] px-1.5 py-0.5 text-[10.5px] text-[var(--muted)]">
                  {typeLabel[item.type]}
                </span>
                <span
                  className={
                    motion && item.id === latestThought
                      ? "thinking-shimmer"
                      : ""
                  }
                >
                  {activityTail(item.text) || "正在接收摘要…"}
                </span>
                {item.type === "tool" && (
                  <span>
                    {(toolItem.status
                      ? toolStatus[toolItem.status]
                      : undefined) ?? toolItem.status}
                  </span>
                )}
              </div>
            );
          })}
          {!preview.length && (
            <div className="desktop-live-status text-[12px] text-[var(--ink-secondary)]">
              <span>
                {hasInput
                  ? "等待你处理下方请求后继续。"
                  : turn.answer?.text
                    ? "正在接收回复"
                    : "Agent 正在处理，等待输出"}
              </span>
              {!hasInput &&
                status === "running" &&
                !turn.answer?.text &&
                elapsed >= 3 && (
                  <small className="text-[11px] text-[var(--muted)]">
                    尚未收到可展示的思考摘要；收到后会自动显示。
                  </small>
                )}
            </div>
          )}
        </div>
      }
      history={
        <div className="desktop-activity-history pt-2">
          {groups.map((group) =>
            group.type === "tools" ? (
              <ToolGroup
                key={group.id}
                group={group}
                onInspect={onReadHistory}
              />
            ) : group.type === "note" ? (
              <div
                key={group.id}
                className="desktop-process-note py-1.5"
                data-history-order={group.event.item.historyOrder}
              >
                {group.event.unknownRole && (
                  <small className="text-[11px] text-[var(--muted)]">
                    历史消息（角色未记录）
                  </small>
                )}
                <MarkdownBody text={group.event.text} />
                <Truncated item={group.event.item as { textTruncated?: boolean }} />
              </div>
            ) : (
              <ActivityItem
                key={group.id}
                activity={group.event}
                onInspect={onReadHistory}
              />
            ),
          )}
        </div>
      }
    />
  );
}

function AnswerActions({ text, name }: { text: string; name: string }) {
  const [state, setState] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setState(""), [text]);

  return (
    <div className="message-actions desktop-answer-actions mt-3 flex items-center gap-2 text-[11.5px] text-[var(--muted)]">
      <button
        type="button"
        aria-label="复制回答"
        disabled={busy}
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[var(--muted)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--fg)]"
        onClick={async () => {
          setBusy(true);
          try {
            if (!navigator.clipboard?.writeText) {
              throw new Error("当前环境不支持剪贴板");
            }
            await navigator.clipboard.writeText(text);
            setState("已复制");
          } catch {
            setState("复制失败，请选择正文复制");
          } finally {
            setBusy(false);
          }
        }}
      >
        {state === "已复制" ? (
          <Check size={13} className="text-[var(--green)]" />
        ) : (
          <Copy size={13} />
        )}
      </button>
      <span>{name}</span>
      {state && <span role="status">{state}</span>}
    </div>
  );
}

export interface TurnChangesSnapshot {
  available?: boolean;
  files?: Array<{
    path: string;
    previewAvailable?: boolean;
    oldText?: string;
    newText?: string;
    binary?: boolean;
  }>;
  added?: number;
  removed?: number;
  notice?: string;
}

export function AgentResponse({
  turn,
  name,
  status,
  hasInput,
  onReadHistory,
  onChanges,
}: {
  turn: TimelineTurn;
  name: string;
  status: string;
  hasInput: boolean;
  onReadHistory?: () => void;
  onChanges?: (snapshot: TurnChangesSnapshot, turnId: string) => void;
  changeCount?: number;
}) {
  if (
    !turn.process.length &&
    !turn.answer &&
    !turn.live &&
    !turn.run?.finishedAt
  ) {
    return null;
  }
  const changes = turn.run?.changes as TurnChangesSnapshot | undefined;
  const changeCount = changes?.available ? (changes.files?.length ?? 0) : 0;

  return (
    <section
      className="assistant-message desktop-agent-turn"
      aria-label={`${name} 的回复`}
    >
      <ActivityFeed
        turn={{ ...turn, activity: turn.process }}
        status={status}
        hasInput={hasInput}
        onReadHistory={onReadHistory ?? (() => {})}
      />
      {turn.answer && (
        <article
          className="desktop-message assistant desktop-agent-reply"
          data-history-order={turn.answer.historyOrder}
        >
          <div>
            <MarkdownBody text={turn.answer.text} />
            <Truncated item={turn.answer} />
          </div>
        </article>
      )}
      {changeCount > 0 && !turn.live && changes && (
        <TurnChangesCard
          fileCount={changeCount}
          added={changes.added ?? 0}
          removed={changes.removed ?? 0}
          onClick={() => onChanges?.(changes, turn.id)}
        />
      )}
      {turn.answer && !turn.live && (
        <AnswerActions text={turn.answer.text} name={name} />
      )}
    </section>
  );
}
