export interface DiscoveredSkill {
  name: string;
  path: string;
  kind: "skill";
  source: string;
  description: string;
}

interface TreeResponse {
  entries?: Array<{ name: string; path: string; kind: string }>;
}

interface FileResponse {
  text?: string;
}

/** 通过已授权的工作区目录树接口发现项目本地技能（.agents/skills 与 .claude/skills） */
export async function discoverComposerSkills(
  read: (path: string, signal?: AbortSignal) => Promise<unknown>,
  sessionId: string,
  signal?: AbortSignal,
): Promise<DiscoveredSkill[]> {
  const tree = (targetPath: string) =>
    read(
      `/sessions/${encodeURIComponent(sessionId)}/tree?path=${encodeURIComponent(targetPath)}`,
      signal,
    ) as Promise<TreeResponse>;
  const root = await tree(".");
  const skills: DiscoveredSkill[] = [];

  for (const base of [".agents", ".claude"]) {
    if (
      !root.entries?.some(
        (entry) => entry.name === base && entry.kind === "directory",
      )
    ) {
      continue;
    }
    const parent = await tree(base);
    if (
      !parent.entries?.some(
        (entry) => entry.name === "skills" && entry.kind === "directory",
      )
    ) {
      continue;
    }
    const catalog = await tree(`${base}/skills`);
    const candidates = (catalog.entries ?? [])
      .filter((entry) => entry.kind === "directory")
      .slice(0, 50);

    // 限制并发读取数，避免技能较多时触发过多目录探测请求
    for (let offset = 0; offset < candidates.length; offset += 4) {
      const batch = await Promise.all(
        candidates.slice(offset, offset + 4).map(async (entry) => {
          const directory = entry.path.replace(/^\.\//, "");
          const contents = await tree(directory);
          if (
            !contents.entries?.some(
              (file) => file.name === "SKILL.md" && file.kind === "file",
            )
          ) {
            return null;
          }
          const skillPath = `${directory}/SKILL.md`;
          let description = "使用此技能处理当前任务";
          try {
            const file = (await read(
              `/sessions/${encodeURIComponent(sessionId)}/file?path=${encodeURIComponent(skillPath)}`,
              signal,
            )) as FileResponse;
            const front = file.text?.match(/^---\r?\n([\s\S]*?)\r?\n---/);
            const line = front?.[1]?.match(/^description:\s*(.+)$/m)?.[1];
            if (line && !["|", ">"].includes(line)) {
              description = line.replace(/^["']|["']$/g, "");
            }
          } catch (error) {
            if (signal?.aborted) {
              throw error;
            }
          }
          return {
            name: entry.name,
            path: skillPath,
            kind: "skill" as const,
            source: `${base}/skills`,
            description,
          };
        }),
      );
      skills.push(
        ...batch.filter((item): item is DiscoveredSkill => item !== null),
      );
    }
  }
  return skills;
}
