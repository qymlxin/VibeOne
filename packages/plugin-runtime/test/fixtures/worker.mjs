import { setTimeout as delay } from 'node:timers/promises';
import { AsyncResource } from 'node:async_hooks';
import { defineWorker } from '@vibeone/plugin-sdk/worker';
const externalCallback = new AsyncResource('outside-invocation');

export default defineWorker(async ({ handle }, instance) => {
  if (instance.config.startupDelay) await delay(instance.config.startupDelay, undefined, { signal: instance.signal });
  let resources = 0;
  handle('resource', (_input, ctx) => {
    resources++;
    ctx.scope.add(() => { resources--; });
    return resources;
  });
  handle('resources', () => resources);
  handle('corrupt', () => { process.stdout.write('invalid protocol frame\n'); return null; });
  handle('spoof-progress', (_input, ctx) => {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'plugin/progress', params: {
      ...ctx.identity, generation: ctx.identity.generation + 99, requestId: ctx.requestId, value: { percent: 999 },
    } })}\n`);
    ctx.progress({ percent: 50 });
    return null;
  });
  instance.scope.add(() => instance.log.info('disposed'));
  handle('inspect', async (input, ctx) => {
    await delay(input?.delay ?? 0, undefined, { signal: ctx.signal });
    return { ...ctx.identity, config: ctx.config, requestId: ctx.requestId, workspaceId: ctx.workspaceId ?? null };
  });
  handle('reverse', async (input, ctx) => ctx.host.call('diagnostics.read', 'echo', input));
  handle('detached-reverse', (input, ctx) => externalCallback.runInAsyncScope(() => ctx.host.call('diagnostics.read', 'echo', input)));
  handle('wait', async (_input, ctx) => {
    await delay(60_000, undefined, { signal: ctx.signal });
    return null;
  });
  handle('progress', async (_input, ctx) => { ctx.progress({ percent: 50 }); return 'done'; });
  handle('fail', () => { throw Error('Fixture failure'); });
  handle('block', () => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3_000); return null; });
});
