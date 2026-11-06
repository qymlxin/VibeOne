import { setTimeout as delay } from 'node:timers/promises';
import { defineWorker } from '@vibeone/plugin-sdk/worker';

export default defineWorker(({ handle }, instance) => {
  instance.scope.add(() => instance.log.info('disposed'));
  handle('inspect', async (input, ctx) => {
    await delay(input?.delay ?? 0, undefined, { signal: ctx.signal });
    return { ...ctx.identity, config: ctx.config, requestId: ctx.requestId, workspaceId: ctx.workspaceId ?? null };
  });
  handle('reverse', async (input, ctx) => ctx.host.call('diagnostics.read', 'echo', input));
  handle('wait', async (_input, ctx) => {
    await delay(60_000, undefined, { signal: ctx.signal });
    return null;
  });
  handle('progress', async (_input, ctx) => { ctx.progress({ percent: 50 }); return 'done'; });
  handle('fail', () => { throw Error('Fixture failure'); });
});
