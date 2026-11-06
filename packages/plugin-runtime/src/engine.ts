import { AsyncLocalStorage } from 'node:async_hooks';
import { pathToFileURL } from 'node:url';
import { Scope } from '@vibeone/plugin-sdk';
import { asObject, PLUGIN_API_VERSION, PLUGIN_PROTOCOL_VERSION, PluginError, requiredString, type Json, type RpcRequest } from '@vibeone/plugin-sdk/protocol';
import type { Handler, HostClient, InstanceContext, InvocationContext, WorkerDefinition } from '@vibeone/plugin-sdk/worker';
import { loadWorkerPackage } from './manifest.js';

interface Transport {
  request(method: string, params: Json, signal?: AbortSignal): Promise<Json>;
  notify(method: string, params: Json): void;
}
interface Execution { instanceId: string; generation: number; requestId?: string; workspaceId?: string; signal: AbortSignal }
interface Instance {
  context: InstanceContext;
  handlers: Map<string, Handler>;
  controller: AbortController;
  scope: Scope;
  ready: boolean;
}

export class PluginEngine {
  readonly #instances = new Map<string, Instance>();
  readonly #calls = new Map<string, { controller: AbortController; instance: Instance }>();
  readonly #execution = new AsyncLocalStorage<Execution>();
  #initialized = false;
  #imports = 0;
  #closed = false;
  constructor(readonly transport: Transport) {}

  async dispatch(request: RpcRequest): Promise<Json> {
    if (this.#closed) throw new PluginError('host_closed', 'Runtime is closed');
    const params = asObject(request.params ?? {});
    if (request.method === 'plugin/initialize') {
      if (params.protocolVersion !== PLUGIN_PROTOCOL_VERSION) throw new PluginError('protocol_incompatible', 'Expected plugin protocol 1');
      this.#initialized = true;
      return { protocolVersion: PLUGIN_PROTOCOL_VERSION, apiVersion: PLUGIN_API_VERSION };
    }
    if (!this.#initialized) throw new PluginError('not_initialized', 'Initialize the runtime first');
    switch (request.method) {
      case 'plugin/activate': return this.#activate(params);
      case 'plugin/invoke': return this.#invoke(params, requiredString(request.id, 'request.id'));
      case 'plugin/cancel': {
        const call = this.#calls.get(requiredString(params.requestId, 'requestId'));
        if (call && (call.instance.context.identity.instanceId !== params.instanceId || call.instance.context.identity.generation !== params.generation)) {
          throw new PluginError('instance_mismatch', 'Cancellation targets a different instance');
        }
        call?.controller.abort();
        return { cancelled: !!call };
      }
      case 'plugin/deactivate': return this.#deactivate(params);
      case 'plugin/health': return { instances: this.#instances.size, calls: this.#calls.size };
      default: throw new PluginError('method_not_found', `Unknown method: ${request.method}`);
    }
  }

  #key(params: Record<string, unknown>): string {
    const instanceId = requiredString(params.instanceId, 'instanceId');
    if (!Number.isSafeInteger(params.generation) || Number(params.generation) < 1) throw new PluginError('invalid_params', 'generation must be a positive safe integer');
    return `${instanceId}#${params.generation}`;
  }

  #host(instance: InstanceContext['identity'], fallbackSignal: AbortSignal): HostClient {
    return { call: (capability, operation, input = null) => {
      const execution = this.#execution.getStore();
      if (execution && (execution.instanceId !== instance.instanceId || execution.generation !== instance.generation)) {
        return Promise.reject(new PluginError('instance_mismatch', 'Host proxy used by another instance'));
      }
      return this.transport.request('host/call', {
        ...instance, requestId: execution?.requestId ?? null, workspaceId: execution?.workspaceId ?? null,
        capability, operation, input,
      }, execution?.signal ?? fallbackSignal);
    } };
  }

  async #activate(params: Record<string, unknown>): Promise<Json> {
    const key = this.#key(params);
    if (this.#instances.has(key)) throw new PluginError('instance_exists', 'Instance generation already exists');
    if (this.#instances.size >= 64) throw new PluginError('busy', 'Too many plugin instances');
    const controller = new AbortController();
    const scope = new Scope();
    const handlers = new Map<string, Handler>();
    // Reserve the slot before asynchronous IO; concurrent activation cannot race it.
    const instance = { controller, handlers, scope, ready: false } as Instance;
    this.#instances.set(key, instance);
    try {
      const pkg = await loadWorkerPackage(requiredString(params.packagePath, 'packagePath'));
      if (controller.signal.aborted) throw new PluginError('cancelled', 'Activation cancelled');
      const identity = Object.freeze({ pluginId: pkg.id, version: pkg.version, instanceId: params.instanceId as string, generation: params.generation as number });
      if (params.pluginId !== pkg.id) throw new PluginError('identity_mismatch', 'Host plugin id does not match package');
      const config = structuredClone(asObject(params.config ?? {})) as Record<string, Json>;
      const context: InstanceContext = Object.freeze({
        identity, config: Object.freeze(config), scope, signal: controller.signal,
        host: this.#host(identity, controller.signal),
        log: { info: (message: string, fields: Json = null) => process.stderr.write(`${JSON.stringify({ pluginId: pkg.id, generation: identity.generation, message, fields })}\n`) },
      });
      instance.context = context;
      await this.#execution.run({ ...identity, signal: controller.signal }, async () => {
        const url = pathToFileURL(pkg.entrypoint);
        url.searchParams.set('generation', `${identity.generation}-${++this.#imports}`);
        const module = await import(url.href);
        if (controller.signal.aborted) throw new PluginError('cancelled', 'Activation cancelled');
        const definition = module.default as WorkerDefinition | undefined;
        if (definition?.apiVersion !== '0.1' || typeof definition.setup !== 'function') throw new PluginError('api_incompatible', 'Worker must export defineWorker() as default');
        let registering = true;
        let cleanup;
        try {
          cleanup = await definition.setup({ handle: (id, handler) => {
            if (!registering || controller.signal.aborted) throw new PluginError('registration_closed', 'Handler registration is closed');
            requiredString(id, 'handler.id');
            if (handlers.has(id) || typeof handler !== 'function') throw new PluginError('invalid_handler', `Duplicate or invalid handler: ${id}`);
            handlers.set(id, handler);
          } }, context);
        } finally { registering = false; }
        if (typeof cleanup === 'function') {
          if (controller.signal.aborted) await cleanup();
          else scope.add(cleanup);
        }
      });
      for (const handler of pkg.handlers) {
        if (!handlers.has(handler)) throw new PluginError('handler_missing', `Declared handler not registered: ${handler}`);
      }
      if (controller.signal.aborted) throw new PluginError('cancelled', 'Activation cancelled');
      instance.ready = true;
      return { ...identity, handlers: [...handlers.keys()].sort() };
    } catch (error) {
      controller.abort();
      if (this.#instances.get(key) === instance) this.#instances.delete(key);
      try { await scope.dispose(); } catch (cleanupError) { console.error(cleanupError); }
      throw error;
    }
  }

  async #invoke(params: Record<string, unknown>, requestId: string): Promise<Json> {
    const instance = this.#instances.get(this.#key(params));
    if (!instance?.ready) throw new PluginError('instance_unavailable', 'Instance is not ready');
    const handler = instance.handlers.get(requiredString(params.handler, 'handler'));
    if (!handler) throw new PluginError('handler_missing', 'Handler is not registered');
    if (this.#calls.has(requestId)) throw new PluginError('duplicate_request', 'Request already executing');
    if (this.#calls.size >= 64) throw new PluginError('busy', 'Too many active plugin calls');
    const timeoutMs = params.timeoutMs ?? 30_000;
    if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) throw new PluginError('invalid_params', 'timeoutMs must be 1..300000');
    const workspaceId = params.workspaceId === undefined ? undefined : requiredString(params.workspaceId, 'workspaceId');
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, instance.controller.signal, AbortSignal.timeout(timeoutMs)]);
    this.#calls.set(requestId, { instance, controller });
    const ctx: InvocationContext = Object.freeze({
      ...instance.context, requestId, workspaceId, signal,
      progress: (value: Json) => {
        if (signal.aborted) return;
        this.transport.notify('plugin/progress', { ...instance.context.identity, requestId, value });
      },
    });
    let abort: () => void = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(new PluginError(signal.reason?.name === 'TimeoutError' ? 'timeout' : 'cancelled', 'Plugin invocation stopped'));
      signal.addEventListener('abort', abort, { once: true });
    });
    const execution = this.#execution.run({ ...instance.context.identity, requestId, workspaceId, signal }, () =>
      Promise.resolve().then(() => handler((params.input ?? null) as Json, ctx)));
    // A non-cooperative handler still consumes capacity after cancellation.
    void execution.finally(() => this.#calls.delete(requestId)).catch(() => {});
    try {
      return await Promise.race([execution, cancelled]);
    } finally {
      // Late callbacks and host calls from a timed-out handler remain cancelled.
      controller.abort();
      signal.removeEventListener('abort', abort);
    }
  }

  async #deactivate(params: Record<string, unknown>): Promise<Json> {
    const key = this.#key(params);
    const instance = this.#instances.get(key);
    if (!instance) return { deactivated: false };
    instance.ready = false;
    instance.controller.abort();
    this.#instances.delete(key);
    await instance.scope.dispose();
    return { deactivated: true };
  }

  async close(): Promise<void> {
    this.#closed = true;
    const instances = [...this.#instances.values()];
    this.#instances.clear();
    for (const instance of instances) { instance.ready = false; instance.controller.abort(); }
    await Promise.allSettled(instances.map(instance => instance.scope.dispose()));
  }
}
