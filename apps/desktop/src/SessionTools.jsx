import {WorkspaceTool,useWorkspaceExtensions} from './workspace-extensions.jsx';
import {AgentConfigControls} from "./AgentConfigControls.jsx";

import {describeTool} from "./tool-presentation.js";
import {ToolDetails} from "./ToolDetails.jsx";
import React, { useEffect, useRef, useState } from "react";

export function SessionTools(props) {
 const {tools,builtins}=useWorkspaceExtensions();
 return props.tab.startsWith('plugin:')||tools.some(tool=>tool.id===props.tab)||builtins.some(tool=>tool.id===props.tab)?<WorkspaceTool key={`${props.session.id}:${props.tab}`} kind={props.tab} {...props}/>:<SessionToolsDetail {...props}/>;
}
function SessionToolsDetail({ session, workbench, tab, act, onLocateRun, availableRunIds=[] }) {
  const [result,setResult]=useState(null);
  const listRequest=useRef(0);
  async function load(){
    const id=++listRequest.current;
    const value=await act(()=>workbench.call(`/sessions/${session.id}/artifacts`));
    if(id===listRequest.current&&value)setResult(value);
  }
  useEffect(()=>{setResult(null);if(tab==='artifacts')void load();return()=>{listRequest.current++;};},[session.id,tab]);
  if (tab === "agent")
    return (
      <section className="desktop-inspector">
        <h2>Agent 当前配置</h2>
        <p>由 Agent 通过 ACP 声明；先发送一条消息建立连接，空闲后可修改。</p>
        <AgentConfigControls session={session} workbench={workbench}/>
        <h3>可用命令</h3>
        <ul>{(session.agentState?.commands??[]).map(command=><li key={command.name}><strong>/{command.name}</strong><p>{command.description}</p></li>)}</ul>
        <h3>上下文与用量</h3>
        <pre>{JSON.stringify(session.agentState?.usage ?? {}, null, 2)}</pre>
      </section>
    );
  if (tab === "artifacts")
    return (
      <section className="desktop-inspector">
        <header>
          <h2>已保存的文本产物</h2>
          <button onClick={() => void load()}>刷新</button>
        </header>
        <p>由用户保存的工作区快照，保留采集时内容并关联最近一次执行。</p>
        {(Array.isArray(result) ? result : []).map((artifact) => (
          <details key={artifact.id}>
            <summary>
              {artifact.path} · {new Date(artifact.createdAt).toLocaleString()}
            </summary>
            <pre>{artifact.content.text}</pre>
            {artifact.content.truncated && <p>保存的快照已截断。</p>}
          </details>
        ))}
      </section>
    );
  if (tab === "runs")
    return (
      <section className="desktop-inspector">
        <h2>执行记录</h2>
        <h3>Agent 工具与命令</h3>
        {session.tools.map(tool=><details key={tool.toolCallId}><summary>{tool.title??tool.name??'工具'} · {tool.status}</summary><ToolDetails tool={tool}/>{availableRunIds.includes(tool.runId)&&<button onClick={()=>onLocateRun(tool.runId)}>定位到对应对话</button>}</details>)}
        {session.agentState?.plan && (
          <details>
            <summary>Agent 计划</summary>
            <pre>{JSON.stringify(session.agentState.plan, null, 2)}</pre>
          </details>
        )}
        {!!session.agentState?.terminals?.length && (
          <details>
            <summary>Agent 终端输出（只读）</summary>
            {session.agentState.terminals.map((terminal, index) => (
              <pre key={index}>
                {terminal.output?.data?decode(terminal.output.data):terminal.data?decode(terminal.data):terminal.command??(terminal.exitStatus?`退出码：${terminal.exitStatus.exitCode}`:'终端事件')}
              </pre>
            ))}
          </details>
        )}
        {!(session.runs ?? []).length && <p>尚无执行记录</p>}
        {[...(session.runs ?? [])].reverse().map((run) => (
          <article key={run.id}>
            <strong>{run.status}</strong> ·{" "}
            <time>{new Date(run.createdAt).toLocaleString()}</time>
            <p>{run.text}</p>
            {run.error && <p role="status">{run.error}</p>}
            {availableRunIds.includes(run.id)&&<button onClick={()=>onLocateRun(run.id)}>定位到对应对话</button>}
          </article>
        ))}
      </section>
    );
  return null;
}

export function Queue({ session, workbench, online, commands }) {
  const {busy,failure}=commands,queue=session.queue??[];
  const change=body=>online?commands.execute(body):Promise.resolve(false);
  if (!queue.length&&!failure&&!busy) return null;
  return (
    <section className="desktop-queue" aria-label="队列控制">
      <header>
        <strong>
          {queue.length?`下一轮 · ${queue.length} 条${session.queuePaused?' · 已暂停':''}`:'队列操作'}
        </strong>
        {queue.length>0&&!session.queuePaused&&<button disabled={!online||busy||!workbench.features?.includes('queuePause')} title={workbench.features?.includes('queuePause')?'当前任务继续，只暂停下一轮':'结束执行后在设置中重启主机以启用暂停'} onClick={()=>void change({pause:true})}>暂停队列</button>}
        {queue.length>0&&session.queuePaused && (
          <button
            disabled={!online||busy}
            onClick={()=>void change({resume:true,freshContext:!!session.historyOnly})}
          >
            {session.historyOnly ? "在新 Agent 上下文执行队列" : "继续队列"}
          </button>
        )}
      </header>
      {busy&&!queue.length&&<p role="status">正在确认队列操作…</p>}
      {failure&&<p role="alert" className="desktop-queue-failure"><span>{failure.message}</span><button disabled={!online||busy} onClick={()=>void commands.retry()}>重试队列操作</button><button disabled={busy} aria-label="关闭队列提示" onClick={commands.dismiss}>关闭提示</button></p>}
      {queue.length>0&&session.queuePaused&&<p>排队消息已暂停；正在执行的任务继续，恢复后再开始下一轮。</p>}
      {session.historyOnly && (
        <p>继续会建立新的 Agent 上下文，不会恢复上一轮的思考或工具状态。</p>
      )}
      {queue.map((run) => (
        <div key={run.id}>
          <span>{run.text}</span>
          <button
            disabled={!online||busy}
            onClick={()=>void change({withdraw:run.id})}
          >
            撤回
          </button>
        </div>
      ))}
    </section>
  );
}

function decode(data) {
  try {
    return new TextDecoder().decode(
      Uint8Array.from(atob(data), (char) => char.charCodeAt(0)),
    );
  } catch {
    return "终端数据无法解码";
  }
}
