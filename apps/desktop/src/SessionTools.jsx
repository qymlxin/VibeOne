import {FileExplorer} from "./FileExplorer.jsx";
import {describeTool} from "./tool-presentation.js";
import {ToolDetails} from "./ToolDetails.jsx";
import React, { useEffect, useRef, useState } from "react";

export function SessionTools(props) {
  return ['files','changes'].includes(props.tab)?<FileExplorer {...props}/>:<SessionToolsDetail {...props}/>;
}
function SessionToolsDetail({ session, workbench, tab, act }) {
  const [result,setResult]=useState(null);
  const listRequest=useRef(0);
  async function load(){
    const id=++listRequest.current;
    const value=await act(()=>workbench.call(`/sessions/${session.id}/artifacts`));
    if(id===listRequest.current&&value)setResult(value);
  }
  useEffect(()=>{setResult(null);if(tab==='artifacts')void load();return()=>{listRequest.current++;};},[session.id,tab]);
  if(tab==='terminal'){
    const tools=session.tools.filter(tool=>tool.kind==='execute'||describeTool(tool).kind==='command');
    const terminals=session.agentState?.terminals ?? [];
    return <section className="desktop-inspector desktop-terminal"><h2>Agent 终端输出（只读）</h2><p>来自当前会话的实际执行记录，不启动交互 Shell。</p>{!tools.length&&!terminals.length&&<p>尚未收到命令或终端输出。</p>}{tools.map(tool=><details key={tool.toolCallId}><summary>{tool.title ?? tool.name ?? '命令'} · {tool.status}</summary><ToolDetails tool={tool}/></details>)}{terminals.map((terminal,index)=><pre key={terminal.id??index}>{terminal.data?decode(terminal.data):JSON.stringify(terminal,null,2)}</pre>)}</section>;
  }
  if (tab === "agent")
    return (
      <section className="desktop-inspector">
        <h2>Agent 当前配置</h2>
        <p>由 Agent 通过 ACP 声明；先发送一条消息建立连接，空闲后可修改。</p>
        {(session.agentState?.configOptions ?? []).map((option) => (
          <AgentOption
            key={option.configId}
            option={option}
            session={session}
            workbench={workbench}
            act={act}
          />
        ))}
        <h3>可用命令</h3>
        <pre>{JSON.stringify(session.agentState?.commands ?? [], null, 2)}</pre>
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
                {terminal.data
                  ? decode(terminal.data)
                  : JSON.stringify(terminal, null, 2)}
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
          </article>
        ))}
      </section>
    );
  return null;
}

export function Queue({ session, workbench, online, act }) {
  if (!(session.queue ?? []).length) return null;
  return (
    <section className="desktop-queue">
      <header>
        <strong>
          下一轮 · {session.queue.length} 条
          {session.queuePaused ? " · 已暂停" : ""}
        </strong>
        {session.queuePaused && (
          <button
            disabled={!online}
            onClick={() =>
              void act(() =>
                workbench.call(`/sessions/${session.id}/queue`, {
                  resume: true,
                  freshContext: !!session.historyOnly,
                }),
              )
            }
          >
            {session.historyOnly ? "在新 Agent 上下文执行队列" : "继续队列"}
          </button>
        )}
      </header>
      {session.historyOnly && (
        <p>继续会建立新的 Agent 上下文，不会恢复上一轮的思考或工具状态。</p>
      )}
      {session.queue.map((run) => (
        <div key={run.id}>
          <span>{run.text}</span>
          <button
            disabled={!online}
            onClick={() =>
              void act(() =>
                workbench.call(`/sessions/${session.id}/queue`, {
                  withdraw: run.id,
                }),
              )
            }
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
function AgentOption({ option, session, workbench, act }) {
  const [value, setValue] = useState(JSON.stringify(option.currentValue));
  const disabled =
    workbench.phase !== "online" ||
    session.historyOnly ||
    ["starting", "running", "requires_action", "cancelling"].includes(
      session.status,
    ) ||
    !!session.queue?.length ||
    (workbench.device && workbench.device.role !== "operator");
  return (
    <form
      className="desktop-management-form"
      onSubmit={(event) => {
        event.preventDefault();
        void act(() =>
          workbench.call(`/sessions/${session.id}/configure`, {
            id: option.configId,
            value: JSON.parse(value),
          }),
        );
      }}
    >
      <label>
        {option.name ?? option.configId}
        <input
          value={value ?? ""}
          onChange={(event) => setValue(event.target.value)}
          disabled={disabled}
        />
      </label>
      <details>
        <summary>选项说明与可用值</summary>
        <pre>{JSON.stringify(option, null, 2)}</pre>
      </details>
      <button disabled={disabled}>应用配置</button>
    </form>
  );
}
