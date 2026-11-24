import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  initialInputJson,
  initialInputValues,
  inputContent,
  inputFields,
  valuesFromInput,
  type InputFieldDescriptor,
  type JsonSchemaObject,
} from "./input-form.ts";
import type { ActRunner, DesktopSession, WorkbenchLike } from "./types.ts";
import "./input-form.css";

function InputField({
  field,
  value,
  onChange,
  id,
}: {
  field: InputFieldDescriptor;
  value: unknown;
  onChange: (value: unknown) => void;
  id: string;
}) {
  const { schema, options, multiple, required, title, secret } = field;
  const hint = schema.description;
  const selected =
    options?.findIndex((option) => Object.is(value, option.value)) ?? -1;
  const selectValue = multiple
    ? ((Array.isArray(value) ? value : []) as unknown[]).map((item) =>
        String(options?.findIndex((option) => Object.is(item, option.value)) ?? -1),
      )
    : selected < 0
      ? ""
      : String(selected);
  const label = (
    <>
      {title}
      <small>{required ? "必填" : "可选"}</small>
    </>
  );

  if (options && options.length <= 6) {
    return (
      <fieldset
        className="request-field request-choices"
        aria-describedby={hint ? `${id}-hint` : undefined}
      >
        <legend>{label}</legend>
        {hint && <p id={`${id}-hint`}>{hint}</p>}
        {options.map((option, index) => (
          <label key={index} className="request-choice">
            <input
              type={multiple ? "checkbox" : "radio"}
              name={id}
              value={index}
              required={!multiple && required}
              checked={
                multiple
                  ? (Array.isArray(value) ? value : []).some((item) =>
                      Object.is(item, option.value),
                    )
                  : Object.is(value, option.value)
              }
              onChange={(event) => {
                if (!multiple) {
                  onChange(option.value);
                  return;
                }
                const list = Array.isArray(value) ? value : [];
                onChange(
                  event.target.checked
                    ? [...list, option.value]
                    : list.filter((item) => !Object.is(item, option.value)),
                );
              }}
            />
            <span>
              {option.label}
              {option.description && <small>{option.description}</small>}
            </span>
          </label>
        ))}
      </fieldset>
    );
  }

  return (
    <div className="request-field">
      <label htmlFor={id}>{label}</label>
      {hint && <p id={`${id}-hint`}>{hint}</p>}
      {options ? (
        <select
          id={id}
          multiple={multiple}
          size={multiple ? 5 : undefined}
          required={required}
          value={selectValue}
          onChange={(event) =>
            onChange(
              multiple
                ? Array.from(
                    event.target.selectedOptions,
                    (option) => options[Number(option.value)]?.value,
                  )
                : event.target.value === ""
                  ? undefined
                  : options[Number(event.target.value)]?.value,
            )
          }
          aria-describedby={hint ? `${id}-hint` : undefined}
        >
          {!multiple && <option value="">请选择</option>}
          {options.map((option, index) => (
            <option key={index} value={index}>
              {option.label}
            </option>
          ))}
        </select>
      ) : schema.type === "boolean" && !required ? (
        <select
          id={id}
          value={value === undefined ? "" : String(value)}
          onChange={(event) =>
            onChange(
              event.target.value === ""
                ? undefined
                : event.target.value === "true",
            )
          }
        >
          <option value="">未填写</option>
          <option value="true">是</option>
          <option value="false">否</option>
        </select>
      ) : schema.type === "boolean" ? (
        <label className="request-choice">
          <input
            id={id}
            type="checkbox"
            checked={value === true}
            onChange={(event) => onChange(event.target.checked)}
          />
          <span>是</span>
        </label>
      ) : (
        <input
          id={id}
          type={
            secret
              ? "password"
              : ["number", "integer"].includes(schema.type ?? "")
                ? "number"
                : schema.format === "email"
                  ? "email"
                  : "text"
          }
          autoComplete="off"
          value={typeof value === "string" || typeof value === "number" ? value : ""}
          required={
            required &&
            (schema.type !== "string" ||
              (typeof schema.minLength === "number" && schema.minLength > 0))
          }
          minLength={
            typeof schema.minLength === "number" ? schema.minLength : undefined
          }
          maxLength={
            typeof schema.maxLength === "number" ? schema.maxLength : undefined
          }
          min={typeof schema.minimum === "number" ? schema.minimum : undefined}
          max={typeof schema.maximum === "number" ? schema.maximum : undefined}
          step={schema.type === "integer" ? 1 : "any"}
          onChange={(event) => onChange(event.target.value)}
          aria-describedby={hint ? `${id}-hint` : undefined}
        />
      )}
    </div>
  );
}

export function InputRequest({
  request,
  session,
  workbench,
  online,
  act,
}: {
  request: NonNullable<DesktopSession["inputs"]>[number];
  session: DesktopSession;
  workbench: Pick<WorkbenchLike, "call">;
  online: boolean;
  act: ActRunner;
}) {
  const schema = request.requestedSchema as JsonSchemaObject | undefined;
  const fields = useMemo(() => inputFields(schema), [schema]);
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    initialInputValues(fields ?? []),
  );
  const [raw, setRaw] = useState(!fields);
  const [json, setJson] = useState(() =>
    JSON.stringify(
      fields
        ? inputContent(fields, initialInputValues(fields), false)
        : JSON.parse(initialInputJson(schema)),
      null,
      2,
    ),
  );
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(
    () =>
      typeof request.expiresAt === "number" &&
      Number.isFinite(request.expiresAt) &&
      request.expiresAt <= Date.now(),
  );
  const pending = useRef(false);
  const id = useId();

  useEffect(() => {
    if (
      typeof request.expiresAt !== "number" ||
      !Number.isFinite(request.expiresAt)
    ) {
      return;
    }
    const timer = setTimeout(
      () => setExpired(true),
      Math.min(2147483647, Math.max(0, request.expiresAt - Date.now())),
    );
    return () => clearTimeout(timer);
  }, [request.expiresAt]);

  const inactive =
    Boolean(session.historyOnly) ||
    Boolean(session.archived) ||
    ["cancelling", "disconnected", "error", "interrupted"].includes(
      session.status,
    );
  const disabled = !online || busy || submitted || expired || inactive;
  const url =
    typeof request.url === "string" && /^https?:\/\//.test(request.url)
      ? request.url
      : null;
  const canAccept = request.mode === "form" || (request.mode === "url" && url);

  function switchEditor() {
    if (!fields) {
      return;
    }
    try {
      if (raw) {
        setValues(valuesFromInput(fields, JSON.parse(json)));
      } else {
        setJson(JSON.stringify(inputContent(fields, values, false), null, 2));
      }
      setRaw(!raw);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function answer(action: "accept" | "decline" | "cancel") {
    if (disabled || pending.current) {
      return;
    }
    let content: unknown;
    try {
      if (action === "accept" && request.mode === "form") {
        content = raw
          ? JSON.parse(json)
          : inputContent(fields ?? [], values);
        if (!content || typeof content !== "object" || Array.isArray(content)) {
          throw new Error("补充输入必须是JSON对象");
        }
      }
    } catch (reason) {
      setError(
        reason instanceof SyntaxError
          ? "JSON格式有误，请检查后再提交"
          : reason instanceof Error
            ? reason.message
            : String(reason),
      );
      return;
    }
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await act(async () => {
        try {
          return await workbench.call(
            `/sessions/${session.id}/inputs/${request.id}`,
            { action, ...(content === undefined ? {} : { content }) },
          );
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : String(reason));
          return null;
        }
      });
      if (result) {
        setSubmitted(true);
      } else {
        pending.current = false;
      }
    } catch (reason) {
      pending.current = false;
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="desktop-input-request"
      aria-labelledby={`${id}-title`}
      aria-busy={busy}
    >
      <header>
        <strong id={`${id}-title`}>需要补充信息</strong>
        <span>
          {session.status === "cancelling"
            ? "正在停止"
            : expired
              ? "已过期"
              : submitted
                ? "已交给主机"
                : busy
                  ? "正在提交"
                  : inactive
                    ? "当前不可操作"
                    : "等待回答"}
        </span>
      </header>
      <p className="request-message">{request.message}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void answer("accept");
        }}
      >
        {request.mode === "form" ? (
          <>
            {fields && (
              <button
                type="button"
                className="request-editor-switch"
                disabled={disabled}
                onClick={switchEditor}
              >
                {raw ? "返回表单" : "使用JSON输入"}
              </button>
            )}
            <fieldset className="request-fields" disabled={disabled}>
              {raw ? (
                <label className="request-field">
                  补充输入 JSON
                  <textarea
                    aria-label="补充输入 JSON"
                    value={json}
                    onChange={(event) => setJson(event.target.value)}
                    spellCheck={false}
                  />
                </label>
              ) : (
                fields?.map((field, index) => (
                  <InputField
                    key={field.key}
                    field={field}
                    id={`${id}-field-${index}`}
                    value={values[field.key]}
                    onChange={(value) =>
                      setValues((previous) => ({
                        ...previous,
                        [field.key]: value,
                      }))
                    }
                  />
                ))
              )}
            </fieldset>
            <details className="request-schema">
              <summary>查看字段要求</summary>
              <pre>{JSON.stringify(request.requestedSchema, null, 2)}</pre>
            </details>
          </>
        ) : url ? (
          <a href={url} target="_blank" rel="noopener noreferrer">
            打开 Agent 提供的页面
          </a>
        ) : (
          <p>当前请求类型无法展示，可拒绝回答或取消。</p>
        )}
        {error && (
          <p role="alert" className="request-error">
            {error}
          </p>
        )}
        {!online && (
          <p className="request-state" role="status">
            当前无法提交，请检查连接或设备操作权限。
          </p>
        )}
        {online && inactive && (
          <p className="request-state" role="status">
            {session.status === "cancelling"
              ? "正在停止，无法提交回答。"
              : "当前会话不可提交此请求。"}
          </p>
        )}
        {(expired || submitted) && (
          <p className="request-state" role="status">
            {expired
              ? "请求已过期，等待主机同步。"
              : "决定已交给主机，等待投递回执。"}
          </p>
        )}
        <div className="request-actions">
          <button
            type="submit"
            className="desktop-button primary"
            disabled={disabled || !canAccept}
          >
            {busy
              ? "正在提交…"
              : request.mode === "url"
                ? "我已完成"
                : "提交回答"}
          </button>
          <button
            type="button"
            className="desktop-button"
            disabled={disabled}
            onClick={() => void answer("decline")}
          >
            拒绝回答
          </button>
          <button
            type="button"
            className="desktop-button"
            disabled={disabled}
            onClick={() => void answer("cancel")}
          >
            取消
          </button>
        </div>
      </form>
    </section>
  );
}
