import React, { useEffect, useState } from "react";

export function SessionTools({ session, workbench, tab, act }) {
  const [result, setResult] = useState(null),
    [preview, setPreview] = useState(null),
    [path, setPath] = useState("."),
    [busy, setBusy] = useState(false);
  async function load(nextPath = path) {
    setBusy(true);
    const result = await act(() =>
      workbench.call(
        `/sessions/${session.id}/${tab === "changes" ? "changes" : "tree"}?path=${encodeURIComponent(nextPath)}`,
      ),
    );
    if (result) setResult(result);
    setBusy(false);
  }
  useEffect(() => {
    setPreview(null);
    setResult(null);
    if (tab !== "runs") void load(".");
  }, [session.id, tab]);
  async function inspect(file, staged = false) {
    if (file.kind === "directory") {
      setPath(file.path);
      await load(file.path);
      return;
    }
    const value = await act(() =>
      workbench.call(
        `/sessions/${session.id}/${tab === "changes" && !file.untracked ? "diff" : "file"}?path=${encodeURIComponent(file.path)}&staged=${staged}`,
      ),
    );
    if (value) setPreview(value);
  }
  if (tab === "runs")
    return (
      <section className="desktop-inspector">
        <h2>执行记录</h2>
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
  return (
    <section className="desktop-inspector">
      <header>
        <h2>{tab === "changes" ? "工作区变更" : "工作区文件"}</h2>
        <button onClick={() => void load()} disabled={busy}>
          刷新
        </button>
      </header>
      {tab === "files" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void load();
          }}
        >
          <input
            aria-label="浏览目录"
            value={path}
            onChange={(event) => setPath(event.target.value)}
          />
          <button>打开目录</button>
        </form>
      )}
      {tab === "changes" && (
        <p>
          {result?.branch} {result?.notice}
        </p>
      )}
      {busy && <p role="status">正在读取…</p>}
      {result?.truncated && <p>列表已截断，请缩小目录范围。</p>}
      {(result?.files ?? result?.entries ?? []).map((file) => (
        <div className="desktop-file-row" key={file.path}>
          <button onClick={() => void inspect(file)}>
            {file.status ?? file.kind} · {file.path}
          </button>
          {file.staged && (
            <button onClick={() => void inspect(file, true)}>已暂存差异</button>
          )}
        </div>
      ))}
      {result && !(result.files ?? result.entries ?? []).length && (
        <p>没有可显示的内容</p>
      )}
      {preview && (
        <article>
          <header>
            <strong>{preview.path}</strong>
            <button onClick={() => setPreview(null)}>关闭预览</button>
          </header>
          {preview.binary ? (
            <p>二进制文件 · {preview.size} 字节</p>
          ) : (
            <pre>
              {preview.text || "没有文本差异；未跟踪文件请在文件页查看。"}
            </pre>
          )}
          {preview.truncated && <p>内容超过显示上限，已截断。</p>}
        </article>
      )}
    </section>
  );
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
