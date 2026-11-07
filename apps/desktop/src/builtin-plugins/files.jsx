import React from 'react';
import {defineApp} from '@vibeone/plugin-sdk/app';
import {FileExplorer} from '../FileExplorer.jsx';
import {useArtifactCapture} from '../use-artifact-capture.js';
function Files(props){const capture=useArtifactCapture(props.workbench,props.session.id);return <FileExplorer {...props} artifactCapture={props.artifactCapture??capture}/>;}
export default defineApp(ctx=>ctx.panels.register('files',Files));
