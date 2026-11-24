export interface CodeLineRow {
  text: string;
  line?: number;
  kind: "plain" | "added" | "removed" | "meta" | "hunk";
}

/** 解析代码或 Unified Diff 文本为带行号的行模型 */
export function codeLines(
  text: string,
  diff = false,
): {
  rows: CodeLineRow[];
  clipped: boolean;
  added: number;
  removed: number;
} {
  let oldLine = 0;
  let newLine = 0;
  let added = 0;
  let removed = 0;
  const all = text.split("\n");
  if (all.at(-1) === "") {
    all.pop();
  }
  const rows: CodeLineRow[] = all.map((lineText, index) => {
    if (diff && lineText.startsWith("diff --git ")) {
      oldLine = 0;
      newLine = 0;
      return { text: lineText, kind: "meta" };
    }
    if (!diff) {
      return { text: lineText, line: index + 1, kind: "plain" };
    }
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(lineText);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      return { text: lineText, kind: "hunk" };
    }
    if ((!oldLine && !newLine) || lineText.startsWith("\\")) {
      return { text: lineText, kind: "meta" };
    }
    if (lineText.startsWith("+")) {
      added++;
      return { text: lineText, line: newLine++, kind: "added" };
    }
    if (lineText.startsWith("-")) {
      removed++;
      return { text: lineText, line: oldLine++, kind: "removed" };
    }
    if (lineText.startsWith(" ")) {
      oldLine++;
      return { text: lineText, line: newLine++, kind: "plain" };
    }
    return { text: lineText, kind: "meta" };
  });
  return {
    rows: rows.filter((row) => !["meta", "hunk"].includes(row.kind)).slice(0, 5000),
    clipped: rows.length > 5000,
    added,
    removed,
  };
}
