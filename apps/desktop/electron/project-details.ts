import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";
import type { ProjectDetailItem, ProjectDetailsResult } from "./ipc.ts";

const git = promisify(execFile);

/** 主机端返回的项目摘要 */
export interface HostProjectSummary {
  id: string;
  paths?: string[];
}

/**
 * 批量读取指定项目的本地路径与当前 Git 分支信息。
 */
export async function projectDetails(
  projects: HostProjectSummary[],
  ids: unknown,
): Promise<ProjectDetailsResult> {
  if (
    !Array.isArray(ids) ||
    ids.length > 64 ||
    ids.some((id): id is string => typeof id !== "string") === false
  ) {
    throw new Error("项目列表无效");
  }
  const idList = ids as string[];
  const allowed = projects.filter((project) => idList.includes(project.id));
  const result: ProjectDetailItem[] = [];

  // 每次最多并发查询 4 个仓库，避免拉起过多 git 子进程
  for (let offset = 0; offset < allowed.length; offset += 4) {
    const chunk = allowed.slice(offset, offset + 4);
    const details = await Promise.all(
      chunk.map(async (project): Promise<ProjectDetailItem> => {
        const directory = project.paths?.[0] ?? null;
        let branch: string | null = null;
        if (directory) {
          try {
            const value = await git(
              "git",
              ["-C", directory, "symbolic-ref", "--quiet", "--short", "HEAD"],
              {
                encoding: "utf8",
                timeout: 1800,
                maxBuffer: 16384,
                windowsHide: true,
                env: {
                  ...process.env,
                  GIT_OPTIONAL_LOCKS: "0",
                  GIT_TERMINAL_PROMPT: "0",
                },
              },
            );
            branch = value.stdout.trim() || null;
          } catch {
            // 非 Git 目录或游离 HEAD 时忽略分支查询失败
          }
        }
        return { id: project.id, path: directory, branch };
      }),
    );
    result.push(...details);
  }

  return { projects: result, homeDirectory: os.homedir() };
}
