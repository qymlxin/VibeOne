import type { Json } from './protocol.js';
import type { Scope, Disposer, Owner } from './scope.js';

export interface PluginIdentity extends Owner {
  readonly pluginId: string;
  readonly version: string;
}

export interface HostClient {
  call(capability: string, operation: string, input?: Json): Promise<Json>;
}

export interface InstanceContext {
  readonly identity: Readonly<PluginIdentity>;
  readonly config: Readonly<Record<string, Json>>;
  readonly host: HostClient;
  readonly signal: AbortSignal;
  readonly scope: Scope;
  readonly log: { info(message: string, fields?: Json): void };
}

export interface InvocationContext extends InstanceContext {
  readonly requestId: string;
  readonly workspaceId?: string;
  readonly signal: AbortSignal;
  progress(value: Json): void;
}

export type Handler = (input: Json, ctx: InvocationContext) => Json | Promise<Json>;
export interface WorkerRegistrar { handle(id: string, handler: Handler): void }
export interface WorkerDefinition {
  readonly apiVersion: '0.1';
  setup(registrar: WorkerRegistrar, ctx: InstanceContext): void | Disposer | Promise<void | Disposer>;
}

export function defineWorker(setup: WorkerDefinition['setup']): WorkerDefinition {
  return Object.freeze({ apiVersion: '0.1', setup });
}
