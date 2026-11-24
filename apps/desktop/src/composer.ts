export interface ComposerToken {
  kind: "@" | "/";
  query: string;
  start: number;
  end: number;
}

export interface ComposerEntry {
  kind: string;
  name: string;
  path?: string;
  description?: string;
}

export interface ComposerSkillItem {
  id?: string;
  name: string;
  path?: string;
  kind?: string;
  source?: string;
  description?: string;
  label?: string;
  control?: string;
  panel?: string;
  nativeCommand?: string;
}

export interface AgentCommandInput {
  name: string;
  description?: string;
}

/** 识别光标位置处的 `@` 或 `/` 自动补全词元，保留中文与 URL 边界语义 */
export function composerToken(
  text: string,
  caret: number,
): ComposerToken | null {
  const prefix = text.slice(0, caret);
  const suffix = text.slice(caret);
  const word = prefix.match(/\S*$/)?.[0] ?? "";
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(word)) {
    return null;
  }
  const quoted =
    /(?:^|[\s\p{Script=Han}，。！？：；、（【「『])@"([^"\n]*)$/u.exec(
      prefix,
    );
  if (quoted && quoted[1] !== undefined) {
    return {
      kind: "@",
      query: quoted[1],
      start: prefix.length - quoted[1].length - 2,
      end: caret + (suffix.match(/^[^"\n]*(?:")?/)?.[0].length ?? 0),
    };
  }
  const match =
    /(?:^|[\s\p{Script=Han}，。！？：；、（【「『])([@/])([^\s]*)$/u.exec(
      prefix,
    );
  if (!match || match[1] === undefined || match[2] === undefined) {
    return null;
  }
  return {
    kind: match[1] as "@" | "/",
    query: match[2],
    start: prefix.length - match[2].length - 1,
    end: caret + (suffix.match(/^[^\s]*/)?.[0].length ?? 0),
  };
}

/** 使用选中的补全值替换输入中的当前词元 */
export function replaceToken(
  text: string,
  token: { start: number; end: number },
  value: string,
): string {
  return text.slice(0, token.start) + value + text.slice(token.end);
}

/** 过滤并排序 `@` 引用候选（文件夹优先于文件，根目录补充本地技能） */
export function referenceOptions<
  TEntry extends ComposerEntry,
  TSkill extends { name: string; path: string },
>(
  entries: TEntry[] | null | undefined,
  query: string,
  skills: TSkill[] = [],
  directory = "",
): Array<TEntry | TSkill> {
  const needle = query.toLowerCase();
  const files = (entries ?? [])
    .filter(
      (item) =>
        ["file", "directory"].includes(item.kind) &&
        item.name.toLowerCase().includes(needle),
    )
    .sort(
      (a, b) =>
        (a.kind === "directory" ? 0 : 1) - (b.kind === "directory" ? 0 : 1) ||
        a.name.localeCompare(b.name),
    );
  const matchingSkills = directory
    ? []
    : skills.filter((item) =>
        `${item.name} ${item.path}`.toLowerCase().includes(needle),
      );
  return [...files, ...matchingSkills];
}

export const localCommands: ComposerSkillItem[] = [
  { name: "files", label: "文件", description: "打开工作区文件", panel: "files" },
  { name: "changes", label: "变更", description: "查看工作区变更", panel: "changes" },
  { name: "terminal", label: "终端", description: "打开交互 Shell，执行命令", panel: "terminal" },
  { name: "runs", label: "执行记录", description: "查看执行记录", panel: "runs" },
  { name: "artifacts", label: "产物", description: "查看会话生成的产物", panel: "artifacts" },
  { name: "agent", label: "Agent 设置", description: "查看当前 Agent 配置", panel: "agent" },
];

export const sessionCommands: ComposerSkillItem[] = [
  {
    name: "model",
    label: "模型",
    description: "选择当前 Agent 使用的模型",
    control: "model",
    source: "会话控制",
  },
  {
    name: "reasoning",
    label: "思考强度",
    description: "调整推理投入与处理深度",
    control: "reasoning",
    source: "会话控制",
  },
  {
    name: "mode",
    label: "工作模式",
    description: "选择 Agent 提供的执行模式",
    control: "mode",
    source: "会话控制",
  },
];

/** 汇总并过滤 `/` 斜杠命令面板候选项 */
export function commandOptions(
  commands: AgentCommandInput[] | null | undefined,
  query: string,
  skills: ComposerSkillItem[] = [],
): ComposerSkillItem[] {
  const reserved = new Set(sessionCommands.map((item) => item.name));
  const advertised = (Array.isArray(commands) ? commands : []).filter(
    (item): item is AgentCommandInput => typeof item?.name === "string",
  );
  const agent: ComposerSkillItem[] = advertised
    .filter((item) => !item.name.startsWith("$") && !reserved.has(item.name))
    .map((item) => ({ ...item, source: "Agent 指令" }));
  const commandNames = new Set(agent.map((item) => item.name));
  const localSkills: ComposerSkillItem[] = skills
    .filter((item) => !commandNames.has(item.name) && !reserved.has(item.name))
    .map((item) => ({ ...item, source: "技能" }));
  const localNames = new Set(localSkills.map((item) => item.name));
  const agentSkills: ComposerSkillItem[] = advertised
    .filter(
      (item) =>
        item.name.startsWith("$") &&
        item.name.length > 1 &&
        !localNames.has(item.name.slice(1)) &&
        !commandNames.has(item.name.slice(1)),
    )
    .map((item) => ({
      ...item,
      id: `agent-skill:${item.name}`,
      name: item.name.slice(1),
      kind: "skill",
      nativeCommand: item.name,
      source: "Agent 技能",
    }));

  const needle = query.toLowerCase();
  return [...sessionCommands, ...agent, ...localSkills, ...agentSkills]
    .filter((item) =>
      `${item.name} ${item.label ?? ""} ${item.description ?? ""}`
        .toLowerCase()
        .includes(needle),
    )
    .slice(0, 100);
}

/** 根据配置项元信息归类为 model / reasoning / mode */
export function configCategory(option: {
  category?: string;
  configId?: string;
  name?: string;
}): "reasoning" | "model" | "mode" {
  const id =
    `${option.category ?? ""} ${option.configId ?? ""} ${option.name ?? ""}`.toLowerCase();
  if (/reason|effort|think|thought|思考|推理/.test(id)) {
    return "reasoning";
  }
  if (/model/.test(id)) {
    return "model";
  }
  return "mode";
}

/** 仅当输入为精确的无参数工作台命令且未被 Agent 覆盖时触发本地面板切换 */
export function commandPanel(
  text: string,
  commands?: Array<{ name?: string }> | null,
): string | null {
  const match = /^\/([^\s]+)$/.exec(text.trim());
  if (!match) {
    return null;
  }
  if (commands?.some((item) => item.name === match[1])) {
    return null;
  }
  return localCommands.find((item) => item.name === match[1])?.panel ?? null;
}

/** 通过已授权工作区接口解析会话组引用的文件/目录内容 */
export async function groupReferenceText(
  read: (path: string) => Promise<{
    binary?: boolean;
    truncated?: boolean;
    entries?: Array<{ path: string }>;
    text?: string;
  }>,
  sessionId: string,
  text: string,
  files: string[],
): Promise<string> {
  if (!files.length) {
    return text;
  }
  const parts = await Promise.all(
    files.map(async (filePath) => {
      const directory = filePath.endsWith("/");
      const result = await read(
        `/sessions/${encodeURIComponent(sessionId)}/${directory ? "tree" : "file"}?path=${encodeURIComponent(filePath)}`,
      );
      if (result.binary) {
        throw new Error(`引用 ${filePath} 是二进制文件，请使用附件入口`);
      }
      if (result.truncated) {
        throw new Error(`引用 ${filePath} 内容过大，请选择更小的文件`);
      }
      const content = directory
        ? (result.entries ?? []).map((item) => item.path).join("\n")
        : result.text;
      if (typeof content !== "string") {
        throw new Error(`引用 ${filePath} 无法作为文本读取`);
      }
      return `[引用${directory ? "文件夹清单" : "文件"}：${filePath}]\n${content}\n[引用结束]`;
    }),
  );
  const prompt = `${text}\n\n${parts.join("\n\n")}`;
  if (new TextEncoder().encode(prompt).length > 12000) {
    throw new Error("会话组引用与消息超过大小限制，请减少引用内容");
  }
  return prompt;
}

/** 生成 `@` 文件浏览或搜索请求路径 */
export function referenceRequest(
  sessionId: string,
  query: string,
  refresh = false,
): { directory: string; browsing: boolean; path: string } {
  const directory = query.includes("/")
    ? query.slice(0, query.lastIndexOf("/") + 1)
    : "";
  const browsing = !query || query.endsWith("/");
  return {
    directory,
    browsing,
    path: browsing
      ? `/sessions/${encodeURIComponent(sessionId)}/tree?path=${encodeURIComponent(directory || ".")}`
      : `/sessions/${encodeURIComponent(sessionId)}/references?query=${encodeURIComponent(query)}${refresh ? "&refresh=true" : ""}`,
  };
}
