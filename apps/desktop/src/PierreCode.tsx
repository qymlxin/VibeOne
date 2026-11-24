import React, { useEffect, useMemo, useState } from "react";
import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";
import {
  File,
  FileDiff,
  MultiFileDiff,
  Virtualizer,
} from "@pierre/diffs/react";

export { Virtualizer };

// 外观由工作台统一管理，Shadow DOM 内通过样式类同步主题模式
export function usePierreTheme(): "light" | "dark" {
  const read = (): "light" | "dark" =>
    document.querySelector(".review-app")?.classList.contains("light")
      ? "light"
      : "dark";
  const [mode, setMode] = useState<"light" | "dark">(read);

  useEffect(() => {
    const root = document.querySelector(".review-app");
    if (!root) {
      return;
    }
    const observer = new MutationObserver(() => setMode(read()));
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    return () => observer.disconnect();
  }, []);

  return mode;
}

const shared = {
  theme: { dark: "pierre-dark", light: "pierre-light" },
  diffStyle: "unified",
  diffIndicators: "bars",
  hunkSeparators: "line-info",
  overflow: "scroll",
  stickyHeader: true,
  unsafeCSS:
    ":host { --diffs-dark-bg:var(--bg,#181818); --diffs-light-bg:var(--bg,#fff); }",
} as const;

export function PierreDiff({
  patch,
  path = "file",
  oldText,
  newText,
  collapsed = false,
  renderHeaderPrefix,
}: {
  patch?: string;
  path?: string;
  oldText?: string | null;
  newText?: string | null;
  collapsed?: boolean;
  renderHeaderPrefix?: (fileDiff: FileDiffMetadata) => React.ReactNode;
}) {
  const themeType = usePierreTheme();
  const options = useMemo(
    () => ({ ...shared, themeType, collapsed }),
    [themeType, collapsed],
  );
  const parsed = useMemo(() => {
    try {
      return {
        files: patch
          ? parsePatchFiles(
              patch.startsWith("@@")
                ? `--- a/${path}\n+++ b/${path}\n${patch}`
                : patch,
            ).flatMap((group) => group.files)
          : [],
        error: false,
      };
    } catch {
      return { files: [] as FileDiffMetadata[], error: true };
    }
  }, [patch, path]);

  const files = parsed.files;
  if (parsed.error || (patch && !files.length)) {
    return (
      <details className="pierre-notice">
        <summary>差异格式无法解析，查看文本</summary>
        <pre>{patch}</pre>
      </details>
    );
  }
  if (patch && files.length) {
    return (
      <>
        {files.map((file, index) => (
          <FileDiff
            key={`${file.name}:${index}`}
            fileDiff={file}
            options={options}
            renderHeaderPrefix={renderHeaderPrefix}
            disableWorkerPool
            className="pierre-diff"
          />
        ))}
      </>
    );
  }
  if (oldText != null && newText != null) {
    return (
      <MultiFileDiff
        oldFile={{ name: path, contents: oldText }}
        newFile={{ name: path, contents: newText }}
        options={options}
        renderHeaderPrefix={renderHeaderPrefix}
        disableWorkerPool
        className="pierre-diff"
      />
    );
  }
  if (newText != null) {
    return (
      <MultiFileDiff
        oldFile={null}
        newFile={{ name: path, contents: newText }}
        options={options}
        renderHeaderPrefix={renderHeaderPrefix}
        disableWorkerPool
        className="pierre-diff"
      />
    );
  }
  if (oldText != null) {
    return (
      <MultiFileDiff
        oldFile={{ name: path, contents: oldText }}
        newFile={null}
        options={options}
        renderHeaderPrefix={renderHeaderPrefix}
        disableWorkerPool
        className="pierre-diff"
      />
    );
  }
  return <p className="pierre-notice">当前范围没有文本差异。</p>;
}

export function PierreFile({ path, text }: { path: string; text: string }) {
  const themeType = usePierreTheme();
  const options = useMemo(
    () => ({ ...shared, themeType, disableFileHeader: true }),
    [themeType],
  );
  const file = useMemo(() => ({ name: path, contents: text }), [path, text]);
  return (
    <File
      file={file}
      options={options}
      disableWorkerPool
      className="pierre-file"
    />
  );
}
