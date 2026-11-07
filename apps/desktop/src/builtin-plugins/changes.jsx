import {defineApp} from '@vibeone/plugin-sdk/app';
import files from './files.jsx';
export default defineApp(ctx=>files.activate({...ctx,panels:{register:(_id,component)=>ctx.panels.register('changes',component)}}));
