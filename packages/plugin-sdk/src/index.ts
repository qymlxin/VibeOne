export { Scope, Registry } from './scope.js';
export type { Owner, Disposer } from './scope.js';
export type { Json } from './protocol.js';
export { PluginError } from './protocol.js';
export { defineWorker } from './worker.js';
export type { Handler, HostClient, InstanceContext, InvocationContext, PluginIdentity, WorkerDefinition } from './worker.js';
export { AppRuntime, defineApp } from './app.js';
export type {
  AppComponent,
  AppContext,
  AppDefinition,
  AppIdentity,
  AppPanelProps,
  AppRegistration,
  DesktopServices,
  PluginComposerServices,
  PluginPanelParams,
  PluginThemeMode,
  PluginUiServices,
} from './app.js';
export type {
  AgentProviderDescriptor,
  HostCapability,
  PluginConfigFieldSchema,
  PluginConfigSchema,
  PluginContribution,
  PluginContributionBinding,
  PluginContributionKind,
  PluginContributionSurface,
  PluginEntrypoints,
  PluginManifest,
} from './manifest.js';
