export interface ToolField {
  label: string;
  value: unknown;
  format?: "links" | "code";
}

export type ToolOutputItem =
  | { type: "value"; value: unknown }
  | {
      type: "diff";
      path?: string;
      oldText?: string;
      newText?: string;
      patch?: string;
    }
  | { type: "link"; name?: string; url?: string }
  | { type: "notice"; text: string };

export interface ToolRecordInput {
  name?: string;
  kind?: string;
  title?: string;
  status?: string;
  rawInput?: unknown;
  output?: unknown;
  rawOutput?: unknown;
  content?: unknown[];
  locations?: Array<string | { path?: string }>;
}

/** 尝试将 JSON 字符串解析为结构化对象，失败时保留原始文本 */
export function parseToolValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const text = value.trim();
  if (
    (text.startsWith("{") && text.endsWith("}")) ||
    (text.startsWith("[") && text.endsWith("]"))
  ) {
    try {
      return JSON.parse(text);
    } catch {
      // 流式输出中的不完整 JSON 或普通文本保持原样
    }
  }
  return value;
}

/** 仅放行 HTTP/HTTPS 工具链接 */
export function safeToolUrl(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const strings = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [value]).filter(
    (item): item is string => typeof item === "string" && Boolean(item.trim()),
  );

const first = (...values: unknown[]): unknown =>
  values.find((value) => value !== undefined && value !== null);

/** 将工具调用的输入与输出规整为结构化展示模型 */
export function describeTool(tool: ToolRecordInput): {
  kind: string;
  fields: ToolField[];
  outputs: ToolOutputItem[];
} {
  const raw = parseToolValue(tool.rawInput);
  const input = asRecord(raw);
  const action = asRecord(input.action);
  const type = String(input.type ?? tool.name ?? tool.kind ?? "").toLowerCase();
  const operation = String(action.type ?? "").toLowerCase();
  let kind = "generic";
  let fields: ToolField[] = [];

  const queries =
    [action.queries, input.queries, action.query, input.query]
      .map(strings)
      .find((values) => values.length) ?? [];
  const searchQueries = queries.length
    ? queries
    : Array.isArray(input.search_query)
      ? (input.search_query as Array<{ q?: unknown }>)
          .map((item) => item?.q)
          .filter((value): value is string => typeof value === "string")
      : [];

  if (operation.includes("find")) {
    kind = "web";
    fields = [
      { label: "网页地址", value: first(action.url, input.url), format: "links" },
      {
        label: "查找内容",
        value: first(action.pattern, input.pattern, action.query),
      },
    ];
  } else if (
    operation === "openpage" ||
    operation === "open" ||
    (!searchQueries.length &&
      first(action.url, input.url) &&
      /web|fetch|open/.test(type))
  ) {
    kind = "web";
    fields = [
      {
        label: "网页地址",
        value: first(action.url, input.url, input.urls),
        format: "links",
      },
    ];
  } else if (
    searchQueries.length ||
    /search/.test(type) ||
    operation === "search"
  ) {
    kind = "search";
    fields = [
      {
        label: "搜索词",
        value: searchQueries.length ? searchQueries : "Agent 尚未提供搜索词",
      },
    ];
    if (input.domains) {
      fields.push({ label: "站点范围", value: input.domains });
    }
  } else if (first(input.command, input.cmd, input.argv) !== undefined) {
    kind = "command";
    const cmdVal = first(input.command, input.cmd, input.argv);
    fields = [
      {
        label: Array.isArray(cmdVal) ? "命令参数" : "命令",
        value: cmdVal,
        format: "code",
      },
    ];
    if (first(input.cwd, input.workdir) !== undefined) {
      fields.push({
        label: "工作目录",
        value: first(input.cwd, input.workdir),
        format: "code",
      });
    }
  } else if (
    first(input.file_path, input.filePath, input.path) !== undefined ||
    Array.isArray(input.changes)
  ) {
    kind = "file";
    const filePath = first(input.file_path, input.filePath, input.path);
    if (filePath !== undefined) {
      fields.push({ label: "文件", value: filePath, format: "code" });
    }
    for (const [key, label] of [
      ["offset", "起始位置"],
      ["limit", "读取上限"],
      ["old_string", "替换前"],
      ["new_string", "替换后"],
      ["diff", "差异"],
      ["content", "写入内容"],
      ["changes", "文件变更"],
    ] as const) {
      if (input[key] != null) {
        fields.push({
          label,
          value: input[key],
          format: ["diff", "old_string", "new_string", "content"].includes(key)
            ? "code"
            : undefined,
        });
      }
    }
  } else if (raw != null) {
    fields = [{ label: "参数", value: raw }];
  }

  const outputs: ToolOutputItem[] = [];
  const append = (value: unknown) => {
    if (value != null && value !== "") {
      outputs.push({ type: "value", value: parseToolValue(value) });
    }
  };
  append(tool.output);
  append(tool.rawOutput);

  for (const rawBlock of Array.isArray(tool.content) ? tool.content : []) {
    const block = asRecord(rawBlock);
    if (block.type === "diff") {
      const changes = Array.isArray(block.changes)
        ? (block.changes as Array<{ path?: string }>)
        : [];
      const patch = asRecord(block.patch);
      outputs.push({
        type: "diff",
        path:
          (typeof block.path === "string" ? block.path : undefined) ??
          changes[0]?.path,
        oldText: typeof block.oldText === "string" ? block.oldText : undefined,
        newText: typeof block.newText === "string" ? block.newText : undefined,
        patch: typeof patch.text === "string" ? patch.text : undefined,
      });
    } else if (block.type === "content") {
      const content = asRecord(block.content);
      if (content.type === "text") {
        append(content.text);
      } else if (content.type === "resource_link") {
        outputs.push({
          type: "link",
          name:
            typeof content.name === "string"
              ? content.name
              : typeof content.title === "string"
                ? content.title
                : undefined,
          url: typeof content.uri === "string" ? content.uri : undefined,
        });
      } else if (content.type === "image") {
        outputs.push({
          type: "notice",
          text: `图片内容（${typeof content.mimeType === "string" ? content.mimeType : "未提供格式"}），原始数据可供查看。`,
        });
      } else if (
        content.type === "resource" &&
        asRecord(content.resource).text != null
      ) {
        append(asRecord(content.resource).text);
      } else {
        outputs.push({
          type: "notice",
          text: `Agent 返回了${typeof content.type === "string" ? content.type : "未知"}内容，详见原始数据。`,
        });
      }
    } else if (block.type === "terminal") {
      outputs.push({
        type: "notice",
        text: "此工具关联终端，终端记录可在 Agent 设置中查看。",
      });
    } else {
      append(rawBlock);
    }
  }

  const seen = new Set<string>();
  return {
    kind,
    fields,
    outputs: outputs.filter((output) => {
      const serialized = JSON.stringify(output);
      if (seen.has(serialized)) {
        return false;
      }
      seen.add(serialized);
      return true;
    }),
  };
}

/** 依据显式 ACP 语义提取读写文件操作（不通过解析 Shell 命令猜测） */
export function describeAction(tool: ToolRecordInput): {
  paths: string[];
  operation: "read" | "edit" | null;
  label: string | null;
} {
  const input = asRecord(parseToolValue(tool.rawInput));
  const locationPaths = Array.isArray(tool.locations)
    ? tool.locations.map((location) =>
        typeof location === "string" ? location : location?.path,
      )
    : [];
  const diffPaths = Array.isArray(tool.content)
    ? tool.content.flatMap((rawBlock) => {
        const block = asRecord(rawBlock);
        if (block.type !== "diff") {
          return [];
        }
        const changes = Array.isArray(block.changes)
          ? (block.changes as Array<{ path?: unknown }>)
          : [];
        return [block.path, ...changes.map((change) => change.path)];
      })
    : [];

  const paths = [
    ...new Set(
      [
        ...strings(first(input.file_path, input.filePath, input.path)),
        ...locationPaths,
        ...diffPaths,
      ].filter(
        (filePath): filePath is string =>
          typeof filePath === "string" && Boolean(filePath.trim()),
      ),
    ),
  ];

  // Codex 的读取事件有时只在标题中携带文件路径
  const titlePath =
    tool.kind === "read"
      ? /^Read file '(.+)'$/.exec(tool.title ?? "")?.[1]
      : null;
  if (!paths.length && titlePath) {
    paths.push(titlePath);
  }
  const operation: "read" | "edit" | null =
    tool.kind === "read" && !/^List files/.test(tool.title ?? "")
      ? "read"
      : tool.kind === "edit"
        ? "edit"
        : null;
  const done = tool.status === "completed";
  return {
    paths,
    operation,
    label:
      operation === "read"
        ? done
          ? "已读取"
          : "读取文件"
        : operation === "edit"
          ? done
            ? "已修改"
            : "修改文件"
          : null,
  };
}
