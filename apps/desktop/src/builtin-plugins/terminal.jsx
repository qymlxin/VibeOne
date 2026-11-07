import React,{lazy,Suspense} from 'react';
import {defineApp} from '@vibeone/plugin-sdk/app';
const Terminal=lazy(()=>import('../TerminalPanel.jsx'));
export default defineApp(ctx=>ctx.panels.register('terminal',props=><Suspense fallback={<p role="status">正在打开终端…</p>}><Terminal {...props}/></Suspense>));
