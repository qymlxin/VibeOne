import React from "react";
import {
  ArrowDown,
  Atom,
  Braces,
  Cog,
  FileCode,
  FileText,
  Minus,
  Plus,
} from "lucide-react";

export function FileTypeIcon({
  path = "",
  size = 14,
}: {
  path?: string;
  size?: number;
}) {
  const extension = path.split(".").at(-1)?.toLowerCase() ?? "";
  if (["jsx", "tsx"].includes(extension)) {
    return (
      <Atom
        size={size}
        className="file-type-icon react-file"
        aria-hidden="true"
      />
    );
  }
  if (["js", "mjs", "cjs", "ts", "css"].includes(extension)) {
    return (
      <span
        className={`file-type-icon type-badge ${extension === "css" ? "css-file" : extension === "ts" ? "ts-file" : "js-file"}`}
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        {extension === "css" ? "CSS" : extension === "ts" ? "TS" : "JS"}
      </span>
    );
  }
  if (extension === "rs") {
    return (
      <span
        className="file-type-icon rust-file rust-icon"
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        <Cog size={size} />
        <b>R</b>
      </span>
    );
  }
  const Icon =
    extension === "json"
      ? Braces
      : ["md", "txt"].includes(extension)
        ? FileText
        : FileCode;
  return (
    <Icon
      size={size}
      className={`file-type-icon ${extension === "json" ? "json-file" : ""}`}
      aria-hidden="true"
    />
  );
}

export interface ChangeFileSummary {
  status?: string;
  untracked?: boolean;
}

export function ChangeStatus({ file }: { file: ChangeFileSummary }) {
  const status = file.status?.trim() ?? "";
  const added = Boolean(file.untracked) || status === "A";
  const deleted = status === "D";
  return (
    <span
      className={`change-status ${deleted ? "deleted" : added ? "new" : "modified"}`}
      title={added ? "新增" : deleted ? "删除" : "已修改"}
    >
      {added ? "A" : deleted ? "D" : "M"}
      {!added && !deleted && <ArrowDown size={9} />}
    </span>
  );
}

export function ChangeMarker({ file }: { file: ChangeFileSummary }) {
  const added = Boolean(file.untracked) || file.status?.trim() === "A";
  const deleted = file.status?.trim() === "D";
  return (
    <span
      className={`change-marker ${added ? "new" : deleted ? "deleted" : "modified"}`}
      aria-label={added ? "新增" : deleted ? "删除" : "修改"}
    >
      {added ? <Plus size={9} /> : deleted ? <Minus size={9} /> : <span />}
    </span>
  );
}
