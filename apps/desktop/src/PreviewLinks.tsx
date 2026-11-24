import React, { createContext, useContext } from "react";
import { previewUrl, workspacePath } from "./preview-links.ts";

export interface PreviewContextValue {
  workspace?: string;
  sessionId?: string;
  read?<T = unknown>(path: string, signal?: AbortSignal): Promise<T>;
  openUrl(url: string): void;
  openFile(path: string): void;
}

export const PreviewContext = createContext<PreviewContextValue | null>(null);

export function PreviewLink({
  href,
  children,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  const preview = useContext(PreviewContext);
  const url = previewUrl(href);
  const path = workspacePath(href, preview?.workspace);
  if (!url && !(preview && path)) {
    return <span>{children}</span>;
  }
  return (
    <a
      {...props}
      href={url ?? "#"}
      target={url ? "_blank" : undefined}
      rel="noopener noreferrer"
      onClick={(event) => {
        if (!preview) {
          return;
        }
        if (
          url &&
          (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        ) {
          return;
        }
        event.preventDefault();
        if (url) {
          preview.openUrl(url);
        } else if (path) {
          preview.openFile(path);
        }
      }}
    >
      {children}
    </a>
  );
}

export function FilePreviewLink({
  path,
  children,
}: {
  path: string;
  children?: React.ReactNode;
}) {
  const preview = useContext(PreviewContext);
  const relative = workspacePath(path, preview?.workspace);
  return preview && relative ? (
    <button
      className="desktop-file-link"
      onClick={() => preview.openFile(relative)}
      title={path}
    >
      {children ?? path}
    </button>
  ) : (
    <code>{children ?? path}</code>
  );
}

export function markdownLink(value: string): string {
  return (
    previewUrl(value) ??
    (typeof value === "string" &&
    !/^(?:javascript|data|vbscript):/i.test(value)
      ? value
      : "")
  );
}
