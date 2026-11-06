import React, { useState } from "react";
export function InputRequest({ request, session, workbench, online, act }) {
  const [content, setContent] = useState(() =>
    JSON.stringify(
      Object.fromEntries(
        Object.entries(request.requestedSchema?.properties ?? {}).map(
          ([key, schema]) => [
            key,
            schema.default ??
              (schema.type === "boolean"
                ? false
                : schema.type === "number" || schema.type === "integer"
                  ? 0
                  : ""),
          ],
        ),
      ),
      null,
      2,
    ),
  );
  const [busy, setBusy] = useState(false);
  async function answer(action) {
    setBusy(true);
    await act(() =>
      workbench.call(`/sessions/${session.id}/inputs/${request.id}`, {
        action,
        ...(action === "accept" && request.mode === "form"
          ? { content: JSON.parse(content) }
          : {}),
      }),
    );
    setBusy(false);
  }
  const url =
    typeof request.url === "string" && /^https?:\/\//.test(request.url)
      ? request.url
      : null;
  return (
    <section className="desktop-input-request">
      <strong>需要补充信息</strong>
      <p>{request.message}</p>
      {request.mode === "form" ? (
        <>
          <details>
            <summary>查看字段要求</summary>
            <pre>{JSON.stringify(request.requestedSchema, null, 2)}</pre>
          </details>
          <textarea
            aria-label="补充输入 JSON"
            value={content}
            onChange={(event) => setContent(event.target.value)}
          />
        </>
      ) : url ? (
        <a href={url} target="_blank" rel="noopener noreferrer">
          打开 Agent 提供的页面
        </a>
      ) : (
        <p>当前模式暂不能展示，请拒绝本次请求。</p>
      )}
      <div>
        <button
          disabled={!online || busy}
          onClick={() => void answer("accept")}
        >
          提交回答
        </button>
        <button
          disabled={!online || busy}
          onClick={() => void answer("decline")}
        >
          拒绝回答
        </button>
        <button
          disabled={!online || busy}
          onClick={() => void answer("cancel")}
        >
          取消
        </button>
      </div>
    </section>
  );
}
