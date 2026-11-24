import React from "react";
import { Check, FolderOpen } from "lucide-react";
import type { PluginConfigSchema } from "@vibeone/plugin-sdk";
import { Badge } from "./components/ui/badge.tsx";
import { Button } from "./components/ui/button.tsx";
import { Card } from "./components/ui/card.tsx";
import { Input } from "./components/ui/input.tsx";
import { Select } from "./components/ui/select.tsx";
import { Switch } from "./components/ui/switch.tsx";
import { Textarea } from "./components/ui/textarea.tsx";
import { capabilityNames, PluginIcon } from "./plugin-presentation.tsx";
import type { PluginRecord } from "./types.ts";

export interface LocalInspectionManifest {
  id: string;
  name?: string;
  version?: string;
  description?: string;
  author?: string;
  hostRequirements?: string[];
  configSchema?: PluginConfigSchema;
  [key: string]: unknown;
}

/** 安全解析当前 JSON 配置字符串为键值对对象 */
function parseConfigObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw.trim() || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // JSON 编辑过程中的半成品语法允许继续输入，表单暂时退回到默认值展示
  }
  return null;
}

/** 根据配置项 schema 提取初始默认值 */
export function buildDefaultPluginConfig(
  schema?: PluginConfigSchema,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema?.properties ?? {})) {
    if (field.default !== undefined) {
      result[key] = field.default;
    }
  }
  return result;
}

export function LocalPluginInstall({
  path,
  onPath,
  inspection,
  busy,
  workspaces,
  selected,
  onSelected,
  config,
  onConfig,
  trusted,
  onTrusted,
  onChoose,
  onInspect,
  onExample,
  onInstall,
}: {
  path: string;
  onPath: (value: string) => void;
  inspection: LocalInspectionManifest | PluginRecord["manifest"] | null;
  busy: boolean;
  workspaces: Array<{ id: string; name: string; path: string }>;
  selected: string[];
  onSelected: (ids: string[]) => void;
  config: string;
  onConfig: (value: string) => void;
  trusted: boolean;
  onTrusted: (value: boolean) => void;
  onChoose: () => void;
  onInspect: () => void;
  onExample: () => void;
  onInstall: () => void;
}) {
  const requiresWorkspace = inspection?.hostRequirements?.some((p) =>
    [
      "workspace.read",
      "artifact.write",
      "desktop.terminal",
      "agent.spawn",
    ].includes(p),
  );

  return (
    <Card className="plugin-local-editor space-y-5 p-6">
      <div className="space-y-2">
        <label
          className="block text-[12.5px] font-medium text-[var(--fg)]"
          htmlFor="local-plugin-path"
        >
          插件包目录
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <FolderOpen
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]"
            />
            <Input
              id="local-plugin-path"
              value={path}
              disabled={busy}
              placeholder="选择包含 plugin.json 的目录"
              className="pl-9 font-mono text-[12px]"
              onChange={(event) => onPath(event.target.value)}
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={onChoose}
          >
            浏览
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy || !path}
            onClick={onInspect}
          >
            {busy ? "检查中…" : "检查"}
          </Button>
        </div>
      </div>

      {inspection && (
        <>
          <div className="flex items-center gap-3.5 border-y border-[var(--line)] py-4">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl border border-[var(--line)] bg-[var(--hover)] text-[var(--fg)]">
              <PluginIcon plugin={{ manifest: inspection }} size={22} />
            </span>
            <div className="min-w-0 flex-1 space-y-0.5">
              <strong className="block truncate text-[14px] font-semibold text-[var(--fg)]">
                {inspection.name ?? inspection.id}
              </strong>
              <small className="block font-mono text-[11.5px] text-[var(--muted)]">
                v{inspection.version}
                {inspection.author ? ` · ${inspection.author}` : ""}
              </small>
              {inspection.description && (
                <p className="m-0 pt-1 text-[12px] leading-relaxed text-[var(--muted)]">
                  {inspection.description}
                </p>
              )}
            </div>
            <Badge variant="success">
              <Check size={12} />
              已检查
            </Badge>
          </div>

          <section className="space-y-2">
            <h3 className="m-0 text-[12.5px] font-semibold text-[var(--fg)]">
              所需权限
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {(inspection.hostRequirements ?? []).map((p) => (
                <Badge key={p} variant="outline">
                  {capabilityNames[p] ?? p}
                </Badge>
              ))}
              {!inspection.hostRequirements?.length && (
                <Badge variant="secondary">无需额外权限</Badge>
              )}
            </div>
          </section>

          {requiresWorkspace && (
            <fieldset className="space-y-2.5 rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4">
              <legend className="px-1 text-[12px] font-medium text-[var(--fg)]">
                授权工作目录
              </legend>
              <div className="flex flex-wrap gap-2.5">
                {workspaces.map((workspace) => (
                  <label
                    key={workspace.id}
                    title={workspace.path}
                    className="inline-flex max-w-full cursor-pointer items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-[12px] transition-colors hover:bg-[var(--hover)]"
                  >
                    <input
                      type="checkbox"
                      className="shrink-0 accent-[var(--accent)]"
                      disabled={busy}
                      checked={selected.includes(workspace.id)}
                      onChange={(event) =>
                        onSelected(
                          event.target.checked
                            ? [...selected, workspace.id]
                            : selected.filter((id) => id !== workspace.id),
                        )
                      }
                    />
                    <FolderOpen
                      size={12}
                      className="shrink-0 text-[var(--muted)]"
                    />
                    <span className="max-w-[220px] truncate">
                      {workspace.name}
                    </span>
                  </label>
                ))}
              </div>
              {!workspaces.length && (
                <p className="m-0 text-[12px] text-[var(--muted)]">
                  尚无可授权的工作目录。
                </p>
              )}
            </fieldset>
          )}

          {inspection.configSchema?.properties &&
            Object.keys(inspection.configSchema.properties).length > 0 && (() => {
              const schema = inspection.configSchema;
              const currentObj = parseConfigObject(config) ?? {};
              const updateField = (key: string, nextValue: unknown) => {
                const next = { ...currentObj, [key]: nextValue };
                onConfig(JSON.stringify(next, null, 2));
              };
              return (
                <section
                  aria-label="插件声明式配置表单"
                  className="space-y-3 rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4"
                >
                  <div className="space-y-0.5">
                    <h3 className="m-0 text-[12.5px] font-semibold text-[var(--fg)]">
                      {schema.title ?? "参数配置"}
                    </h3>
                    {schema.description && (
                      <p className="m-0 text-[11.5px] text-[var(--muted)]">
                        {schema.description}
                      </p>
                    )}
                  </div>
                  <div className="grid gap-3">
                    {Object.entries(schema.properties).map(([key, field]) => {
                      const fieldId = `plugin-cfg-${key}`;
                      const labelText = field.title ?? key;
                      const value =
                        currentObj[key] !== undefined
                          ? currentObj[key]
                          : field.default;

                      if (field.type === "boolean") {
                        return (
                          <div
                            key={key}
                            className="flex items-center justify-between gap-4 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3.5 py-2.5"
                          >
                            <div className="min-w-0 space-y-0.5">
                              <label
                                htmlFor={fieldId}
                                className="block text-[12.5px] font-medium text-[var(--fg)]"
                              >
                                {labelText}
                              </label>
                              {field.description && (
                                <p className="m-0 text-[11.5px] text-[var(--muted)]">
                                  {field.description}
                                </p>
                              )}
                            </div>
                            <Switch
                              id={fieldId}
                              checked={Boolean(value)}
                              disabled={busy}
                              onCheckedChange={(checked) =>
                                updateField(key, checked)
                              }
                            />
                          </div>
                        );
                      }

                      if (Array.isArray(field.enum) && field.enum.length > 0) {
                        return (
                          <label
                            key={key}
                            htmlFor={fieldId}
                            className="grid gap-1.5 text-[12px]"
                          >
                            <span className="font-medium text-[var(--fg)]">
                              {labelText}
                            </span>
                            <Select
                              id={fieldId}
                              disabled={busy}
                              value={value !== undefined ? String(value) : ""}
                              onChange={(event) => {
                                const rawVal = event.target.value;
                                const match = field.enum?.find(
                                  (item) => String(item) === rawVal,
                                );
                                updateField(key, match ?? rawVal);
                              }}
                            >
                              {field.enum.map((opt) => (
                                <option key={String(opt)} value={String(opt)}>
                                  {String(opt)}
                                </option>
                              ))}
                            </Select>
                            {field.description && (
                              <span className="text-[11px] text-[var(--muted)]">
                                {field.description}
                              </span>
                            )}
                          </label>
                        );
                      }

                      const isNumeric =
                        field.type === "number" || field.type === "integer";
                      return (
                        <label
                          key={key}
                          htmlFor={fieldId}
                          className="grid gap-1.5 text-[12px]"
                        >
                          <span className="font-medium text-[var(--fg)]">
                            {labelText}
                          </span>
                          <Input
                            id={fieldId}
                            type={isNumeric ? "number" : "text"}
                            disabled={busy}
                            min={field.minimum}
                            max={field.maximum}
                            step={field.type === "integer" ? 1 : "any"}
                            placeholder={field.placeholder ?? ""}
                            value={
                              value !== undefined && value !== null
                                ? String(value)
                                : ""
                            }
                            onChange={(event) => {
                              const raw = event.target.value;
                              if (isNumeric) {
                                const parsed = Number(raw);
                                updateField(
                                  key,
                                  raw === "" || Number.isNaN(parsed)
                                    ? undefined
                                    : parsed,
                                );
                              } else {
                                updateField(key, raw);
                              }
                            }}
                          />
                          {field.description && (
                            <span className="text-[11px] text-[var(--muted)]">
                              {field.description}
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </section>
              );
            })()}

          <details className="border-b border-[var(--line)] pb-4">
            <summary className="cursor-pointer text-[12px] text-[var(--muted)] hover:text-[var(--fg)]">
              插件配置 <span className="ml-1 font-mono text-[10.5px]">JSON</span>
            </summary>
            <div className="mt-3">
              <Textarea
                aria-label="插件配置（JSON）"
                rows={4}
                className="font-mono text-[12px]"
                value={config}
                disabled={busy}
                onChange={(event) => onConfig(event.target.value)}
              />
            </div>
          </details>

          <label className="flex cursor-pointer items-center gap-2.5 text-[12.5px] font-medium text-[var(--fg)]">
            <input
              type="checkbox"
              className="accent-[var(--accent)]"
              checked={trusted}
              disabled={busy}
              onChange={(event) => onTrusted(event.target.checked)}
            />
            信任此插件及上述权限
          </label>

          <footer className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <span className="text-[12px] text-[var(--muted)]">
              安装后立即启用，无需重启应用。
            </span>
            <Button
              size="sm"
              disabled={busy || !trusted}
              onClick={onInstall}
            >
              {busy ? "正在保存…" : "保存并启用"}
            </Button>
          </footer>
        </>
      )}

      <details className="pt-1 text-[11.5px] text-[var(--muted)]">
        <summary className="cursor-pointer hover:text-[var(--fg)]">
          开发选项
        </summary>
        <div className="mt-3">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={onExample}
          >
            选择内置示例插件
          </Button>
        </div>
      </details>
    </Card>
  );
}
