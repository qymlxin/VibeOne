import type {
  ArtifactRecord,
  DecisionRecord,
  DeviceView,
  JsonValue,
  PendingRequest,
  PinnedProfile,
  PluginLifecycleAction,
  PluginOperationSummary,
  ProfileIssue,
  ProfileView,
  Provider,
  RunRecord,
  WorkspaceView,
} from "@vibeone/client-contracts";
import type { PluginConfigSchema } from "@vibeone/plugin-sdk";
import type { AgentConfigOptionInput } from "./agent-config.ts";
import type {
  TimelineMessage,
  TimelineRun,
  TimelineTool,
} from "./chat-timeline.ts";
import type { SyncDiagnostics } from "./workbench-sync.ts";
import type { WorkbenchPhase } from "./use-workbench.ts";

export interface AgentCommandMeta {
  name: string;
  description?: string;
}

export interface AgentTerminalEntry {
  command?: string;
  data?: string;
  output?: { data?: string };
  exitStatus?: { exitCode?: number };
}

export interface SessionAgentState {
  commands?: AgentCommandMeta[];
  configOptions?: AgentConfigOptionInput[];
  contextRestoreState?: string;
  plan?: unknown;
  terminals?: AgentTerminalEntry[];
  usage?: unknown;
}

export interface DesktopSession {
  id: string;
  title: string;
  provider: string;
  workspace: string;
  workspaceId?: string;
  status: string;
  archived?: boolean;
  historyOnly?: boolean;
  historySequence?: number;
  lastActivityAt?: number;
  error?: string | null;
  stopReason?: string | null;
  profile?: PinnedProfile | null;
  agentState?: SessionAgentState | null;
  approvals: Array<
    PendingRequest & {
      title?: string;
      description?: string;
      subject?: unknown;
    }
  >;
  inputs?: Array<
    PendingRequest & {
      mode?: string;
      message?: string;
      url?: string;
      requestedSchema?: Record<string, unknown>;
    }
  >;
  decisions?: DecisionRecord[];
  queue?: Array<TimelineRun & { text?: string }>;
  queuePaused?: boolean;
  runs?: Array<
    TimelineRun & {
      changes?: {
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
      };
      attachments?: Array<{
        id: string;
        name: string;
        kind: "image" | "text" | "resource";
        size: number;
      }>;
    }
  >;
  messages: TimelineMessage[];
  tools: TimelineTool[];
}

export interface PluginContribution {
  id: string;
  kind: string;
  surface?: string;
  title?: string;
  description?: string;
  icon?: string;
  binding?: { type?: string; handler?: string };
}

export interface PluginRecord {
  id: string;
  name?: string;
  version: string;
  generation: number;
  enabled?: boolean;
  path: string;
  error?: string;
  capabilities?: string[];
  workspaces?: string[];
  config?: Record<string, unknown>;
  source?: {
    repository: string;
    directory?: string;
    revision?: string;
  } | null;
  manifest: {
    id?: string;
    name?: string;
    version?: string;
    description?: string;
    author?: string;
    hostRequirements?: string[];
    contributions?: PluginContribution[];
    entrypoints?: { app?: string };
    configSchema?: PluginConfigSchema;
  };
}

export interface PluginEventRecord {
  pluginId?: string;
  text?: string;
  [key: string]: unknown;
}

export interface NotificationRecord {
  id?: string;
  message?: string;
  [key: string]: unknown;
}

export interface WorkbenchLike {
  apiVersion?: number;
  protocolVersion?: number;
  revision?: number;
  persistent?: boolean;
  device?: DeviceView | null;
  examplePluginPath?: string | null;
  features?: string[];
  notifications?: NotificationRecord[];
  operations?: PluginOperationSummary[];
  pluginEvents?: PluginEventRecord[];
  plugins?: PluginRecord[];
  profileIssues?: ProfileIssue[];
  profiles?: ProfileView[];
  providers: Provider[];
  sessions: DesktopSession[];
  storageError?: string | null;
  workspaces?: WorkspaceView[];
  syncDiagnostics?: SyncDiagnostics;
  dataDirectory?: string;
  migrationPending: boolean;
  migrationWarning?: string;
  phase: WorkbenchPhase;
  error: string;
  call<T = unknown>(path: string, body?: unknown): Promise<T>;
  read<T = unknown>(path: string, signal?: AbortSignal): Promise<T>;
  invokePlugin(id: string, body: Record<string, unknown>): Promise<unknown>;
  managePlugin(
    action: PluginLifecycleAction,
    input: JsonValue & { id?: string },
  ): Promise<unknown>;
  reconnect(): Promise<void>;
  restart(): Promise<void>;
}

export interface ProjectItem {
  id: string;
  name: string;
  paths: string[];
  implicit?: boolean;
}

export interface ProjectsController {
  items: ProjectItem[];
  error: string;
  reload(): Promise<void>;
  save(body: {
    id?: string;
    name?: string;
    addPath?: string;
  }): Promise<ProjectItem>;
}

export interface SpaceAgent {
  id: string;
  projectId: string;
  sessionId: string;
  name: string;
  role?: string;
  provider?: string;
  profileId?: string;
  workspace?: string;
  color?: string;
  shape?: string;
  groupId?: string | null;
  steward?: boolean;
}

export interface SpaceThread {
  id: string;
  projectId: string;
  name: string;
  members: string[];
  groupId?: string | null;
  coordination?: boolean;
  state?: string;
  error?: string;
  activeSession?: string;
  bindings?: Record<string, string>;
}

export interface SpaceGroup {
  id: string;
  projectId: string;
  name: string;
}

export interface SpacePreset {
  id: string;
  name: string;
  role?: string;
  provider?: string;
  profileId?: string;
  color?: string;
  shape?: string;
  model?: { id: string; value: string } | null;
}

export interface SpacesController {
  agents: SpaceAgent[];
  threads: SpaceThread[];
  groups: SpaceGroup[];
  presets: SpacePreset[];
  error: string;
  enabled: boolean;
  hidden: Set<string>;
  reload(): Promise<void>;
  command(body: Record<string, unknown>): Promise<Record<string, unknown>>;
  agentFor(sessionId: string | null | undefined): SpaceAgent | undefined;
  threadFor(sessionId: string | null | undefined): SpaceThread | undefined;
}

export type ActRunner = <T>(operation: () => Promise<T>) => Promise<T | null>;

export type ArtifactCaptureHook = {
  save(path: string): Promise<ArtifactRecord | null>;
  busy: boolean;
  failure: { path: string; message: string } | null;
  notice: string;
  retry(): Promise<ArtifactRecord | null>;
  dismiss(): void;
};
