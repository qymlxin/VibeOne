import { defineWorker } from '@vibeone/plugin-sdk/worker';

export default defineWorker(({ handle }, instance) => {
  instance.scope.add(() => instance.log.info('工作区工具已停用'));
  handle('workspace.scan', async (input, ctx) => {
    ctx.progress({ message: '正在读取工作区目录' });
    const result = await ctx.host.call('workspace.read', 'scan', input);
    ctx.progress({ message: '目录读取完成' });
    return result;
  });
});
