import type { Json } from './protocol.js';

/** 宿主授权给插件的能力标识 */
export type HostCapability =
  | 'workspace.read'
  | 'artifact.write'
  | 'desktop.terminal'
  | 'desktop.browser'
  | 'agent.spawn'
  | 'notifications.send';

/** 贡献点类型 */
export type PluginContributionKind =
  | 'app.panel'
  | 'app.command'
  | 'settings.section'
  | 'agent.provider'
  | 'notification.channel';

/** 面板/UI 贡献点的建议挂载位置 */
export type PluginContributionSurface =
  | 'workspace.tool'
  | 'plugin.settings'
  | 'command.palette'
  | (string & {});

/** 声明式配置字段 Schema（用于在插件中心自动生成配置表单） */
export interface PluginConfigFieldSchema {
  type: 'string' | 'number' | 'integer' | 'boolean';
  title?: string;
  description?: string;
  default?: Json;
  enum?: readonly Json[];
  placeholder?: string;
  minimum?: number;
  maximum?: number;
}

/** 声明式配置对象 Schema */
export interface PluginConfigSchema {
  type?: 'object';
  title?: string;
  description?: string;
  required?: readonly string[];
  properties: Readonly<Record<string, PluginConfigFieldSchema>>;
}

/** 声明式 Agent Provider 启动描述 */
export interface AgentProviderDescriptor {
  command: string;
  args?: readonly string[];
  env?: Readonly<Record<string, string>>;
  transport?: string;
}

/** 插件贡献点绑定方式 */
export type PluginContributionBinding =
  | { type: 'app' }
  | { type: 'worker'; handler: string }
  | { type: 'declarative'; descriptor: AgentProviderDescriptor };

/** 单个贡献点声明 */
export interface PluginContribution {
  id: string;
  kind: PluginContributionKind;
  kindVersion: 1;
  surface?: PluginContributionSurface;
  title?: string;
  description?: string;
  icon?: string;
  binding: PluginContributionBinding;
}

/** 插件入口配置 */
export interface PluginEntrypoints {
  worker?: {
    path: string;
    runtime: 'node';
    protocolVersion: 1;
  };
  app?: {
    path: string;
    runtime?: 'react' | 'esm';
  };
}

/** VibeOne 插件清单（plugin.json）完整契约 */
export interface PluginManifest {
  $schema?: string;
  manifestVersion: 1;
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  engines: {
    pluginApi: '>=0.1 <0.2';
  };
  hostRequirements?: readonly HostCapability[];
  entrypoints?: PluginEntrypoints;
  contributions: readonly PluginContribution[];
  configSchema?: PluginConfigSchema;
}
