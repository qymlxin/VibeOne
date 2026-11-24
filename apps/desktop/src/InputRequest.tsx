import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { Alert } from "./components/ui/alert.tsx";
import { Badge } from "./components/ui/badge.tsx";
import { Button } from "./components/ui/button.tsx";
import { Card } from "./components/ui/card.tsx";
import { Input } from "./components/ui/input.tsx";
import { Select } from "./components/ui/select.tsx";
import { Textarea } from "./components/ui/textarea.tsx";
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
        String(
          options?.findIndex((option) => Object.is(item, option.value)) ?? -1,
        ),
      )
    : selected < 0
      ? ""
      : String(selected);
  const label = (
    <span className="inline-flex items-center gap-2 text-[13px] font-medium text-[var(--fg)]">
      <span>{title}</span>
      <Badge variant={required ? "default" : "outline"} className="py-0 text-[10.5px]">
        {required ? "必填" : "可选"}
      </Badge>
    </span>
  );

  if (options && options.length <= 6) {
    return (
      <fieldset
        className="request-field request-choices space-y-2 border-0 p-0"
        aria-describedby={hint ? `${id}-hint` : undefined}
      >
        <legend className="mb-1 p-0">{label}</legend>
        {hint && (
          <p id={`${id}-hint`} className="m-0 text-[12px] text-[var(--muted)]">
            {hint}
          </p>
        )}
        <div className="space-y-1.5">
          {options.map((option, index) => (
            <label
              key={index}
              className="request-choice flex cursor-pointer items-start gap-2.5 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2.5 text-[13px] transition-colors hover:bg-[var(--hover)]"
            >
              <input
                type={multiple ? "checkbox" : "radio"}
                name={id}
                value={index}
                required={!multiple && required}
                className="mt-1 shrink-0 accent-[var(--accent)]"
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
              <span className="min-w-0 space-y-0.5 [overflow-wrap:anywhere]">
                <span className="block font-medium text-[var(--fg)]">
                  {option.label}
                </span>
                {option.description && (
                  <small className="block text-[12px] text-[var(--muted)]">
                    {option.description}
                  </small>
                )}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  }

  return (
    <div className="request-field space-y-1.5">
      <label htmlFor={id} className="block">
        {label}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="m-0 text-[12px] text-[var(--muted)]">
          {hint}
        </p>
      )}
      {options ? (
        multiple ? (
          <select
            id={id}
            multiple
            size={5}
            required={required}
            value={selectValue}
            className="w-full rounded-lg border border-[var(--line)] bg-[var(--bg)] p-2 text-[13px] text-[var(--fg)]"
            onChange={(event) =>
              onChange(
                Array.from(
                  event.target.selectedOptions,
                  (option) => options[Number(option.value)]?.value,
                ),
              )
            }
            aria-describedby={hint ? `${id}-hint` : undefined}
          >
            {options.map((option, index) => (
              <option key={index} value={index}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          <Select
            id={id}
            required={required}
            value={selectValue}
            wrapperClassName="w-full"
            onChange={(event) =>
              onChange(
                event.target.value === ""
                  ? undefined
                  : options[Number(event.target.value)]?.value,
              )
            }
            aria-describedby={hint ? `${id}-hint` : undefined}
          >
            <option value="">请选择</option>
            {options.map((option, index) => (
              <option key={index} value={index}>
                {option.label}
              </option>
            ))}
          </Select>
        )
      ) : schema.type === "boolean" && !required ? (
        <Select
          id={id}
          wrapperClassName="w-full"
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
        </Select>
      ) : schema.type === "boolean" ? (
        <label className="request-choice inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-[13px]">
          <input
            id={id}
            type="checkbox"
            className="accent-[var(--accent)]"
            checked={value === true}
            onChange={(event) => onChange(event.target.checked)}
          />
          <span>是</span>
        </label>
      ) : (
        <Input
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
          value={
            typeof value === "string" || typeof value === "number" ? value : ""
          }
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

  const statusText =
    session.status === "cancelling"
      ? "正在停止"
      : expired
        ? "已过期"
        : submitted
          ? "已交给主机"
          : busy
            ? "正在提交"
            : inactive
              ? "当前不可操作"
              : "等待回答";

  return (
    <Card
      aria-labelledby={`${id}-title`}
      aria-busy={busy}
      className="desktop-input-request my-3 border border-[color-mix(in_srgb,var(--accent)_28%,var(--line))] p-5"
    >
      <section className="space-y-3">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <strong id={`${id}-title`} className="text-[14px] font-semibold">
            需要补充信息
          </strong>
          <Badge variant={expired ? "destructive" : submitted ? "success" : "default"}>
            {statusText}
          </Badge>
        </header>
        <p className="request-message m-0 text-[13px] leading-relaxed text-[var(--ink-secondary)]">
          {request.message}
        </p>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void answer("accept");
          }}
        >
          {request.mode === "form" ? (
            <>
              {fields && (
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={disabled}
                    onClick={switchEditor}
                  >
                    {raw ? "返回表单" : "使用JSON输入"}
                  </Button>
                </div>
              )}
              <fieldset
                className="request-fields space-y-4 border-0 p-0"
                disabled={disabled}
              >
                {raw ? (
                  <label className="request-field block space-y-1.5 text-[13px] font-medium">
                    <span>补充输入 JSON</span>
                    <Textarea
                      aria-label="补充输入 JSON"
                      rows={6}
                      className="font-mono text-[12px]"
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
              <details className="request-schema text-[12px] text-[var(--muted)]">
                <summary className="cursor-pointer select-none">查看字段要求</summary>
                <pre className="mt-2 max-h-[220px] overflow-auto rounded-lg border border-[var(--line)] bg-[var(--bg)] p-3 font-mono text-[11.5px] whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {JSON.stringify(request.requestedSchema, null, 2)}
                </pre>
              </details>
            </>
          ) : url ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex text-[13px] font-medium text-[var(--link)] underline underline-offset-4"
            >
              打开 Agent 提供的页面
            </a>
          ) : (
            <p className="m-0 text-[12.5px] text-[var(--muted)]">
              当前请求类型无法展示，可拒绝回答或取消。
            </p>
          )}
          {error && (
            <Alert variant="destructive" role="alert" className="request-error">
              {error}
            </Alert>
          )}
          {!online && (
            <Alert variant="warning" className="request-state" role="status">
              当前无法提交，请检查连接或设备操作权限。
            </Alert>
          )}
          {online && inactive && (
            <p className="request-state m-0 text-[12px] text-[var(--muted)]" role="status">
              {session.status === "cancelling"
                ? "正在停止，无法提交回答。"
                : "当前会话不可提交此请求。"}
            </p>
          )}
          {(expired || submitted) && (
            <p className="request-state m-0 text-[12px] text-[var(--muted)]" role="status">
              {expired
                ? "请求已过期，等待主机同步。"
                : "决定已交给主机，等待投递回执。"}
            </p>
          )}
          <div className="request-actions flex flex-wrap justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => void answer("cancel")}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => void answer("decline")}
            >
              拒绝回答
            </Button>
            <Button type="submit" size="sm" disabled={disabled || !canAccept}>
              {busy
                ? "正在提交…"
                : request.mode === "url"
                  ? "我已完成"
                  : "提交回答"}
            </Button>
          </div>
        </form>
      </section>
    </Card>
  );
}
