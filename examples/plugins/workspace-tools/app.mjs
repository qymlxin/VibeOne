import React, { useState, useSyncExternalStore } from 'react';
import { defineApp } from '@vibeone/plugin-sdk/app';

export default defineApp((ctx) => {
  function WorkspacePanel({ workspaceId, theme = 'dark', params }) {
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');
    const snapshot = useSyncExternalStore(
      ctx.services.workbench.subscribe,
      ctx.services.workbench.snapshot,
    );

    const scanPath =
      typeof params?.path === 'string'
        ? params.path
        : typeof ctx.config.defaultPath === 'string'
          ? ctx.config.defaultPath
          : '.';

    async function scan() {
      try {
        setError('');
        const output = await ctx.services.invokeWorker(
          'workspace.scan',
          { path: scanPath },
          workspaceId,
        );
        setResult(output);
        ctx.services.ui?.notify?.(`已完成目录 ${scanPath} 扫描`, 'success');
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }

    function insertResultToComposer() {
      if (!result) return;
      ctx.services.composer?.insertText(
        `已扫描目录 \`${scanPath}\`：\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``,
      );
      ctx.services.ui?.notify?.('已将扫描摘要插入对话输入框', 'info');
    }

    return React.createElement(
      'section',
      { className: 'p-4 space-y-3 text-[12.5px]' },
      React.createElement('h3', { className: 'm-0 text-sm font-semibold' }, '插件工作区面板'),
      React.createElement(
        'p',
        { className: 'm-0 text-[var(--muted)]' },
        `当前 ${(snapshot?.sessions ?? []).length} 个会话 · 主题：${theme === 'light' ? '亮色' : '暗色'}`,
      ),
      React.createElement(
        'div',
        { className: 'flex flex-wrap gap-2' },
        React.createElement(
          'button',
          {
            type: 'button',
            disabled: !workspaceId,
            className: 'rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5',
            onClick: () => void scan(),
          },
          '通过 Worker 读取目录',
        ),
        result &&
          ctx.services.composer &&
          React.createElement(
            'button',
            {
              type: 'button',
              className: 'rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5',
              onClick: insertResultToComposer,
            },
            '插入结果到输入框',
          ),
      ),
      error && React.createElement('p', { role: 'alert', className: 'text-[var(--red)]' }, error),
      result &&
        React.createElement(
          'pre',
          { className: 'overflow-x-auto rounded-lg border border-[var(--line)] p-3 font-mono text-[11px]', style: { whiteSpace: 'pre-wrap' } },
          JSON.stringify(result, null, 2),
        ),
    );
  }

  ctx.panels.register('workspace-panel', WorkspacePanel);
  ctx.settings.register('workspace-settings', () =>
    React.createElement('p', { className: 'text-[12px] text-[var(--muted)]' }, `示例配置：${JSON.stringify(ctx.config)}`),
  );
});
