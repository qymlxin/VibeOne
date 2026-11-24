#!/usr/bin/env node
/**
 * VibeOne 插件包校验工具（CLI 与可复用校验函数）
 * 与 Rust 宿主（crates/workbench/src/plugins.rs）及 plugin.schema.json 规则保持严格一致。
 */
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const VALID_CAPABILITIES = new Set([
  "workspace.read",
  "artifact.write",
  "desktop.terminal",
  "desktop.browser",
  "agent.spawn",
  "notifications.send",
]);

const VALID_CONFIG_TYPES = new Set(["string", "number", "integer", "boolean"]);
const MAX_MANIFEST_BYTES = 65536;
const MAX_APP_BYTES = 16 * 1024 * 1024;

/** 解析包内相对路径并防止越界或符号链接穿透 */
function resolvePackageFile(packageRoot, relPath, label) {
  if (typeof relPath !== "string" || !relPath.trim()) {
    throw new Error(`${label} 路径不能为空`);
  }
  if (isAbsolute(relPath)) {
    throw new Error(`${label} 不能使用绝对路径：${relPath}`);
  }
  const normalizedSegments = relPath.split(/[\\/]/).filter(Boolean);
  if (normalizedSegments.includes("..")) {
    throw new Error(`${label} 路径包含不允许的父目录跳转（..）：${relPath}`);
  }
  const target = resolve(packageRoot, relPath);
  const rel = relative(packageRoot, target);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`${label} 超出插件目录范围：${relPath}`);
  }
  if (!existsSync(target)) {
    throw new Error(`${label} 文件不存在：${relPath}`);
  }
  const lstat = lstatSync(target);
  if (lstat.isSymbolicLink()) {
    throw new Error(`${label} 不允许为符号链接：${relPath}`);
  }
  const realRoot = realpathSync(packageRoot);
  const realTarget = realpathSync(target);
  const realRel = relative(realRoot, realTarget);
  if (realRel.startsWith("..") || isAbsolute(realRel)) {
    throw new Error(`${label} 真实路径超出插件包目录：${relPath}`);
  }
  const st = statSync(target);
  if (!st.isFile()) {
    throw new Error(`${label} 不是普通文件：${relPath}`);
  }
  return { target, size: st.size };
}

/** 使用 node --check 校验 ESM/JS 语法 */
function checkJsSyntax(filePath, label) {
  if (!/\.(?:mjs|js|cjs)$/i.test(filePath)) {
    return;
  }
  try {
    execFileSync(process.execPath, ["--check", filePath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const stderr = err && typeof err === "object" && "stderr" in err ? String(err.stderr) : String(err);
    throw new Error(`${label} JavaScript 语法检查失败：\n${stderr.trim()}`);
  }
}

/**
 * 校验单个插件目录，返回 `{ ok, pluginId, name, version, errors, warnings }`
 */
export function validatePluginDirectory(pluginDir) {
  const errors = [];
  const warnings = [];
  const root = resolve(pluginDir);

  if (!existsSync(root) || !statSync(root).isDirectory()) {
    return {
      ok: false,
      dir: root,
      errors: [`插件目录不存在或不是文件夹：${root}`],
      warnings,
    };
  }

  const manifestPath = resolve(root, "plugin.json");
  if (!existsSync(manifestPath) || !statSync(manifestPath).isFile()) {
    return {
      ok: false,
      dir: root,
      errors: ["缺少必需的 plugin.json 清单文件"],
      warnings,
    };
  }

  const manifestStat = statSync(manifestPath);
  if (manifestStat.size > MAX_MANIFEST_BYTES) {
    errors.push(`plugin.json 体积超过上限（${manifestStat.size} > ${MAX_MANIFEST_BYTES} 字节）`);
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (err) {
    return {
      ok: false,
      dir: root,
      errors: [`plugin.json 不是合法 JSON：${err instanceof Error ? err.message : String(err)}`],
      warnings,
    };
  }

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return {
      ok: false,
      dir: root,
      errors: ["plugin.json 根节点必须是 JSON 对象"],
      warnings,
    };
  }

  // 基本字段与兼容性
  const id = manifest.id;
  if (typeof id !== "string" || !id || id.length > 128 || !/^[A-Za-z0-9._-]+$/.test(id)) {
    errors.push("id 无效：必须为 1–128 位字母、数字、点号（.）、下划线（_）或短横线（-）");
  }
  if (typeof manifest.name !== "string" || !manifest.name.trim()) {
    errors.push("name 缺失：必须提供非空插件名称");
  }
  if (typeof manifest.version !== "string" || !manifest.version.trim()) {
    errors.push("version 缺失：必须提供非空版本号（如 0.1.0）");
  }
  if (!manifest.description) {
    warnings.push("建议在 plugin.json 中补充 description，以便插件中心展示功能说明");
  }
  if (manifest.manifestVersion !== 1) {
    errors.push(`manifestVersion 必须为 1（当前：${String(manifest.manifestVersion)}）`);
  }
  if (manifest.engines?.pluginApi !== ">=0.1 <0.2") {
    errors.push(`engines.pluginApi 必须为 ">=0.1 <0.2"（当前：${String(manifest.engines?.pluginApi)}）`);
  }

  // 自包含约束（Rust 会拒绝包含外部 npm dependencies 的插件）
  if (
    manifest.dependencies &&
    (typeof manifest.dependencies !== "object" ||
      Array.isArray(manifest.dependencies) ||
      Object.keys(manifest.dependencies).length > 0)
  ) {
    errors.push("当前宿主要求插件自包含运行：不可在 plugin.json 中声明非空 dependencies");
  }

  // hostRequirements 校验
  const capabilities = Array.isArray(manifest.hostRequirements) ? manifest.hostRequirements : [];
  if (manifest.hostRequirements !== undefined && !Array.isArray(manifest.hostRequirements)) {
    errors.push("hostRequirements 必须为字符串数组");
  } else {
    for (const cap of capabilities) {
      if (typeof cap !== "string" || !VALID_CAPABILITIES.has(cap)) {
        errors.push(`不支持的宿主权限能力：${String(cap)}`);
      }
    }
  }

  // 入口文件校验
  const entrypoints = manifest.entrypoints;
  if (entrypoints !== undefined) {
    if (!entrypoints || typeof entrypoints !== "object" || Array.isArray(entrypoints)) {
      errors.push("entrypoints 必须为对象");
    } else {
      if (entrypoints.worker !== undefined) {
        const worker = entrypoints.worker;
        if (!worker || typeof worker !== "object") {
          errors.push("entrypoints.worker 必须为对象");
        } else {
          if (worker.runtime !== "node") {
            errors.push(`entrypoints.worker.runtime 必须为 "node"`);
          }
          if (worker.protocolVersion !== 1) {
            errors.push(`entrypoints.worker.protocolVersion 必须为 1`);
          }
          try {
            const { target } = resolvePackageFile(root, worker.path, "entrypoints.worker");
            checkJsSyntax(target, "entrypoints.worker");
          } catch (err) {
            errors.push(err instanceof Error ? err.message : String(err));
          }
        }
      }
      if (entrypoints.app !== undefined) {
        const app = entrypoints.app;
        if (!app || typeof app !== "object") {
          errors.push("entrypoints.app 必须为对象");
        } else {
          try {
            const { target, size } = resolvePackageFile(root, app.path, "entrypoints.app");
            if (size > MAX_APP_BYTES) {
              errors.push(`entrypoints.app 文件体积超过 16 MiB 上限：${size}`);
            }
            checkJsSyntax(target, "entrypoints.app");
          } catch (err) {
            errors.push(err instanceof Error ? err.message : String(err));
          }
        }
      }
    }
  }

  // contributions 扩展点校验
  if (!Array.isArray(manifest.contributions)) {
    errors.push("contributions 必须为数组");
  } else {
    const seenIds = new Set();
    for (const item of manifest.contributions) {
      if (!item || typeof item !== "object") {
        errors.push("contributions 中存在非对象条目");
        continue;
      }
      if (typeof item.id !== "string" || !item.id.trim()) {
        errors.push("contributions 条目缺少有效 id");
        continue;
      }
      if (seenIds.has(item.id)) {
        errors.push(`contributions 中存在重复 id：${item.id}`);
      }
      seenIds.add(item.id);
      if (item.kindVersion !== 1) {
        errors.push(`扩展点 ${item.id} 的 kindVersion 必须为 1`);
      }

      const bindingType = item.binding?.type;
      switch (item.kind) {
        case "app.panel":
        case "settings.section":
          if (bindingType !== "app") {
            errors.push(`扩展点 ${item.id} (${item.kind}) 的 binding.type 必须为 "app"`);
          }
          if (!entrypoints?.app) {
            errors.push(`扩展点 ${item.id} 依赖前端界面，但未声明 entrypoints.app`);
          }
          break;
        case "app.command":
          if (bindingType !== "app" && bindingType !== "worker") {
            errors.push(`扩展点 ${item.id} (app.command) 的 binding.type 必须为 "app" 或 "worker"`);
          }
          if (bindingType === "worker" && typeof item.binding?.handler !== "string") {
            errors.push(`扩展点 ${item.id} 绑定 Worker 时必须指定 binding.handler`);
          }
          break;
        case "notification.channel":
          if (bindingType !== "worker") {
            errors.push(`扩展点 ${item.id} (notification.channel) 的 binding.type 必须为 "worker"`);
          }
          break;
        case "agent.provider": {
          if (!capabilities.includes("agent.spawn")) {
            errors.push(`扩展点 ${item.id} (agent.provider) 必须在 hostRequirements 中声明 "agent.spawn"`);
          }
          const descriptor = item.binding?.descriptor;
          const cmd = descriptor?.command;
          if (bindingType !== "declarative" || typeof cmd !== "string" || !cmd.trim()) {
            errors.push(`扩展点 ${item.id} (agent.provider) 必须使用 declarative 绑定并声明 descriptor.command`);
            break;
          }
          if (cmd !== "$node" && !isAbsolute(cmd)) {
            try {
              resolvePackageFile(root, cmd, `provider ${item.id} command`);
            } catch (err) {
              errors.push(err instanceof Error ? err.message : String(err));
            }
          }
          if (descriptor.args !== undefined) {
            if (!Array.isArray(descriptor.args) || descriptor.args.length > 64) {
              errors.push(`扩展点 ${item.id} 的 descriptor.args 必须为不超过 64 项的数组`);
            } else {
              for (const arg of descriptor.args) {
                if (typeof arg !== "string" || arg.length > 4096) {
                  errors.push(`扩展点 ${item.id} 的 descriptor.args 包含非法参数或超长字符串`);
                  continue;
                }
                if (arg.startsWith("$package/")) {
                  const sub = arg.slice("$package/".length);
                  try {
                    resolvePackageFile(root, sub, `provider ${item.id} $package arg`);
                  } catch (err) {
                    errors.push(err instanceof Error ? err.message : String(err));
                  }
                }
              }
            }
          }
          break;
        }
        default:
          errors.push(`未知扩展点类型：${String(item.kind)}（id=${item.id}）`);
      }
    }
  }

  // configSchema 校验（声明式配置表单）
  if (manifest.configSchema !== undefined) {
    const schema = manifest.configSchema;
    if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
      errors.push("configSchema 必须为对象");
    } else {
      if (schema.type !== undefined && schema.type !== "object") {
        errors.push(`configSchema.type 必须为 "object"`);
      }
      if (!schema.properties || typeof schema.properties !== "object" || Array.isArray(schema.properties)) {
        errors.push("configSchema.properties 必须为对象");
      } else {
        for (const [key, field] of Object.entries(schema.properties)) {
          if (!field || typeof field !== "object" || !VALID_CONFIG_TYPES.has(field.type)) {
            errors.push(`configSchema.properties.${key}.type 必须为 string / number / integer / boolean 之一`);
          }
        }
      }
    }
  }

  return {
    ok: errors.length === 0,
    dir: root,
    pluginId: typeof id === "string" ? id : undefined,
    name: typeof manifest.name === "string" ? manifest.name : undefined,
    version: typeof manifest.version === "string" ? manifest.version : undefined,
    errors,
    warnings,
  };
}

// 作为 CLI 执行时：node scripts/validate-plugin.mjs <dir1> [dir2...]
const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const dirs = process.argv.slice(2);
  if (dirs.length === 0) {
    console.error("用法: npm run plugin:validate -- <插件目录> [更多插件目录...]");
    process.exit(2);
  }
  let hasError = false;
  for (const dir of dirs) {
    const result = validatePluginDirectory(dir);
    if (result.ok) {
      console.log(`✔ 校验通过: ${result.name ?? result.pluginId} (${result.pluginId}@${result.version}) -> ${result.dir}`);
      for (const warn of result.warnings) {
        console.log(`  ⚠ 提示: ${warn}`);
      }
    } else {
      hasError = true;
      console.error(`✘ 校验失败: ${result.dir}`);
      for (const err of result.errors) {
        console.error(`  - ${err}`);
      }
    }
  }
  if (hasError) {
    process.exit(1);
  }
}
