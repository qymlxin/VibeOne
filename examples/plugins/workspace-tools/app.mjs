import React, {useState} from 'react';
import {defineApp} from '@vibeone/plugin-sdk/app';

export default defineApp(ctx => {
  function WorkspacePanel({workspaceId}) {
    const [result,setResult]=useState(null),[error,setError]=useState('');
    async function scan(){try{setError('');setResult(await ctx.services.invokeWorker('workspace.scan',{path:'.'},workspaceId));}catch(error){setError(error.message);}}
    return React.createElement('section',null,
      React.createElement('h3',null,'插件工作区面板'),
      React.createElement('button',{disabled:!workspaceId,onClick:()=>void scan()},'通过 Worker 读取目录'),
      error&&React.createElement('p',{role:'alert'},error),
      result&&React.createElement('pre',{style:{whiteSpace:'pre-wrap'}},JSON.stringify(result,null,2)));
  }
  ctx.panels.register('workspace-panel',WorkspacePanel);
});
