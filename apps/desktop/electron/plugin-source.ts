import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { PluginFetchResult, PluginPackageEntry } from "./ipc.ts";

const exec = promisify(execFile);

/** 规范化并校验 GitHub 仓库克隆地址 */
export function repositoryUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/[\w.-]+\/[\w.-]+(?:\.git)?\/?$/.test(url.pathname)
  ) {
    throw new Error("请输入 GitHub 仓库地址");
  }
  const repoPath = url.pathname
    .split("/")
    .filter(Boolean)
    .join("/")
    .replace(/\.git$/, "");
  return `https://github.com/${repoPath}.git`;
}

/** 扫描已检出的仓库目录，发现其中包含 plugin.json 的插件包 */
export async function discoverPluginPackages(
  checkout: string,
  source: { repository?: string; revision: string },
): Promise<{
  packages: PluginPackageEntry[];
  warnings: string[];
  source: { repository?: string; revision: string };
}> {
  const root = await fs.realpath(checkout);
  const packages: PluginPackageEntry[] = [];
  const warnings: string[] = [];
  let visited = 0;

  const walk = async (directory: string, depth: number): Promise<void> => {
    if (++visited > 5000) {
      throw new Error("仓库目录过多，请缩小插件仓库");
    }
    const manifestPath = path.join(directory, "plugin.json");
    try {
      const info = await fs.lstat(manifestPath);
      if (!info.isFile() || info.size > 65536) {
        throw new Error("清单必须是64KiB以内的普通文件");
      }
      const manifest = JSON.parse(
        await fs.readFile(manifestPath, "utf8"),
      ) as Record<string, unknown>;
      packages.push({
        path: directory,
        source: {
          repository: source.repository ?? "",
          revision: source.revision,
          directory: path.relative(root, directory).split(path.sep).join("/"),
        },
        manifest,
      });
      if (packages.length > 64) {
        throw new Error("仓库插件超过64个");
      }
      return;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== "ENOENT") {
        if (packages.length > 64) {
          throw error;
        }
        warnings.push(`${path.relative(root, directory) || "."}：${err.message}`);
        return;
      }
    }

    if (depth >= 8) {
      warnings.push(
        `${path.relative(root, directory)}：超过8层扫描深度，已跳过`,
      );
      return;
    }

    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (
        entry.isDirectory() &&
        !entry.name.startsWith(".") &&
        !["node_modules", "dist", "target", "build", "vendor"].includes(
          entry.name,
        )
      ) {
        await walk(path.join(directory, entry.name), depth + 1);
      }
    }
  };

  await walk(root, 0);
  return { packages, warnings, source };
}

/** 从远程仓库浅克隆插件源码并解析目录与修订号 */
export async function fetchPluginSource(
  dataDir: string,
  input: { repository: string; directory?: string },
): Promise<PluginFetchResult> {
  const repository = repositoryUrl(input.repository);
  const base = path.join(dataDir, "plugin-downloads");
  await fs.mkdir(base, { recursive: true, mode: 0o700 });
  const checkout = path.join(base, crypto.randomUUID());
  const options = {
    timeout: 120000,
    maxBuffer: 1024 * 1024,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o ConnectTimeout=15",
    },
  };

  try {
    try {
      await exec(
        "git",
        ["clone", "--depth", "1", "--no-recurse-submodules", "--", repository, checkout],
        options,
      );
    } catch {
      await fs.rm(checkout, { recursive: true, force: true });
      await exec(
        "git",
        [
          "clone",
          "--depth",
          "1",
          "--no-recurse-submodules",
          "--",
          repository.replace("https://github.com/", "git@github.com:"),
          checkout,
        ],
        options,
      );
    }

    const revision = (
      await exec("git", ["-C", checkout, "rev-parse", "HEAD"], options)
    ).stdout.trim();

    if (input.directory === undefined) {
      const discovered = await discoverPluginPackages(checkout, {
        repository: repository.replace(/\.git$/, ""),
        revision,
      });
      return {
        packages: discovered.packages,
        warnings: discovered.warnings,
        source: {
          repository: repository.replace(/\.git$/, ""),
          revision,
        },
      };
    }

    const directory = String(input.directory ?? "").replace(/\\/g, "/");
    if (
      directory.startsWith("/") ||
      directory.split("/").some((segment) => segment === "..") ||
      directory.includes("\0")
    ) {
      throw new Error("插件目录必须是仓库内相对路径");
    }

    const checkoutRoot = await fs.realpath(checkout);
    const packagePath = await fs.realpath(path.join(checkout, directory));
    if (
      packagePath !== checkoutRoot &&
      !packagePath.startsWith(checkoutRoot + path.sep)
    ) {
      throw new Error("插件目录超出仓库");
    }

    await fs.access(path.join(packagePath, "plugin.json"));
    return {
      path: packagePath,
      source: {
        repository: repository.replace(/\.git$/, ""),
        directory,
        revision,
      },
    };
  } catch (error) {
    await fs.rm(checkout, { recursive: true, force: true });
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`插件下载失败：${message.slice(0, 350)}`);
  }
}
