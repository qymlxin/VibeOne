import React, { useContext, useEffect, useRef, useState } from "react";
import { File, X } from "lucide-react";
import { PreviewContext } from "./PreviewLinks.tsx";
import type { WorkbenchLike } from "./types.ts";
import "./attachments.css";

export interface AttachmentItem {
  id: string;
  name: string;
  kind: "image" | "text" | "resource";
  size: number;
}

interface AttachmentDownloadPayload {
  kind: string;
  mimeType: string;
  data: string;
  name: string;
}

const imageTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

const key = (id: string) => `vibeone-attachments:${id}`;

function readDraft(id: string): AttachmentItem[] {
  try {
    const items = JSON.parse(
      localStorage.getItem(key(id)) ?? "[]",
    ) as unknown[];
    return Array.isArray(items)
      ? items
          .filter(
            (item): item is AttachmentItem =>
              Boolean(item) &&
              typeof item === "object" &&
              typeof (item as AttachmentItem).id === "string" &&
              typeof (item as AttachmentItem).name === "string" &&
              ["image", "text", "resource"].includes(
                (item as AttachmentItem).kind,
              ),
          )
          .slice(0, 5)
      : [];
  } catch {
    return [];
  }
}

const encode = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("无法读取文件"));
    reader.onabort = () => reject(new Error("文件读取已取消"));
    reader.readAsDataURL(file);
  });

export function useAttachmentDraft({
  session,
  workbench,
  disabled,
  onMutate,
}: {
  session: { id: string };
  workbench: Pick<WorkbenchLike, "phase" | "features" | "call">;
  disabled: boolean;
  onMutate: () => void;
}) {
  const [items, setItems] = useState<AttachmentItem[]>(() =>
    readDraft(session.id),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const current = useRef(items);
  const uploading = useRef(false);

  const replace = (next: AttachmentItem[]) => {
    current.current = next;
    setItems(next);
    onMutate();
    try {
      if (next.length) {
        localStorage.setItem(key(session.id), JSON.stringify(next));
      } else {
        localStorage.removeItem(key(session.id));
      }
    } catch {
      // 忽略本地存储异常
    }
  };

  async function add(files: File[]) {
    if (disabled || uploading.current) {
      return;
    }
    if (workbench.phase !== "online") {
      setError("连接主机后可上传附件");
      return;
    }
    if (!workbench.features?.includes("attachments")) {
      setError("主机尚不支持附件，结束执行后在设置中重启主机以更新。");
      return;
    }
    uploading.current = true;
    setBusy(true);
    setError("");
    try {
      for (const file of files) {
        if (current.current.length >= 5) {
          throw new Error("每轮最多添加5个上传附件");
        }
        if (
          current.current.reduce((total, item) => total + item.size, 0) +
            file.size >
          16 * 1024 * 1024
        ) {
          throw new Error("每轮上传附件总量不能超过16MiB");
        }
        if (file.size > 4 * 1024 * 1024) {
          throw new Error(`${file.name} 超过4MiB限制`);
        }
        const encoded = await encode(file);
        const mimeType =
          file.type === "image/svg+xml"
            ? "text/plain"
            : file.type || "application/octet-stream";
        const item = await workbench.call<AttachmentItem>(
          `/sessions/${session.id}/attachments`,
          { name: file.name, mimeType, data: encoded },
        );
        if (!current.current.some((previous) => previous.id === item.id)) {
          replace([...current.current, item]);
        }
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      uploading.current = false;
      setBusy(false);
    }
  }

  async function remove(item: AttachmentItem) {
    if (disabled || uploading.current) {
      return;
    }
    replace(current.current.filter((previous) => previous.id !== item.id));
    if (workbench.phase !== "online") {
      return;
    }
    try {
      await workbench.call(
        `/sessions/${session.id}/attachments/${encodeURIComponent(item.id)}/remove`,
        {},
      );
    } catch {
      setError("已移出草稿，但主机缓存清理失败；历史附件仍保留。");
    }
  }

  const onPaste = (event: React.ClipboardEvent) => {
    const files = [...(event.clipboardData?.files ?? [])];
    if (files.length) {
      event.preventDefault();
      void add(files);
    }
  };

  const onDrop = (event: React.DragEvent) => {
    if (!event.dataTransfer?.types.includes("Files")) {
      return;
    }
    event.preventDefault();
    if (
      [...event.dataTransfer.items].some(
        (item) => item.webkitGetAsEntry?.()?.isDirectory,
      )
    ) {
      setError("文件夹请使用 @ 工作区引用，或选择其中的文件。");
      return;
    }
    void add([...event.dataTransfer.files]);
  };

  return {
    items,
    busy,
    error,
    add,
    remove,
    replace,
    online: workbench.phase === "online",
    onPaste,
    onDrop,
    onDragOver: (event: React.DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) {
        event.preventDefault();
      }
    },
  };
}

export function AttachmentCard({
  item,
  onRemove,
  disabled = false,
}: {
  item: AttachmentItem;
  onRemove?: (item: AttachmentItem) => void;
  disabled?: boolean;
}) {
  const context = useContext(PreviewContext);
  const ref = useRef<HTMLDivElement | null>(null);
  const [image, setImage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const url = `/sessions/${context?.sessionId}/attachments/${encodeURIComponent(item.id)}`;

  useEffect(() => {
    if (item.kind !== "image" || !context?.read) {
      return;
    }
    let started = false;
    let disposed = false;
    const controller = new AbortController();
    const load = () => {
      if (started) {
        return;
      }
      started = true;
      void context
        .read?.<AttachmentDownloadPayload>(url, controller.signal)
        .then((value) => {
          if (
            !disposed &&
            value.kind === "image" &&
            imageTypes.has(value.mimeType)
          ) {
            setImage(`data:${value.mimeType};base64,${value.data}`);
          }
        })
        .catch((reason) => {
          if (!disposed) {
            setError(
              reason instanceof Error ? reason.message : "附件不可用",
            );
          }
        });
    };
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
              load();
            }
          });
    if (observer && ref.current) {
      observer.observe(ref.current);
    } else {
      load();
    }
    return () => {
      disposed = true;
      controller.abort();
      observer?.disconnect();
    };
  }, [item.id, item.kind, context?.read, url]);

  async function download() {
    if (!context?.read) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const value = await context.read<AttachmentDownloadPayload>(url);
      const bytes = Uint8Array.from(atob(value.data), (character) =>
        character.charCodeAt(0),
      );
      const resource = URL.createObjectURL(
        new Blob([bytes], { type: "application/octet-stream" }),
      );
      const anchor = document.createElement("a");
      anchor.href = resource;
      anchor.download = value.name;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(resource), 30000);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={ref} className="desktop-attachment-card">
      <div className="desktop-attachment-heading">
        <File size={13} />
        <span title={item.name}>{item.name}</span>
        {onRemove && (
          <button
            type="button"
            disabled={disabled}
            aria-label={`移除附件 ${item.name}`}
            onClick={() => onRemove(item)}
          >
            <X size={13} />
          </button>
        )}
      </div>
      {item.kind === "image" ? (
        image ? (
          <details>
            <summary aria-label={`预览图片 ${item.name}`}>
              <img src={image} alt={item.name} />
              <small>展开 / 收起</small>
            </summary>
            <img
              className="desktop-attachment-full"
              src={image}
              alt={`${item.name} 大图`}
            />
          </details>
        ) : (
          <p>{error ? "图片暂不可用" : "正在读取缩略图…"}</p>
        )
      ) : (
        <small>
          {Math.ceil(item.size / 1024)} KiB ·{" "}
          {item.kind === "text" ? "文本附件" : "文件附件"}
        </small>
      )}
      {!onRemove && context?.read && (
        <button
          type="button"
          className="desktop-attachment-download"
          disabled={busy}
          onClick={() => void download()}
        >
          {busy ? "正在读取…" : "下载附件"}
        </button>
      )}
      {error && <small role="status">{error}</small>}
    </div>
  );
}

export function AttachmentCards({ items }: { items?: AttachmentItem[] }) {
  return items?.length ? (
    <div className="desktop-attachment-cards">
      {items.map((item) => (
        <AttachmentCard key={item.id} item={item} />
      ))}
    </div>
  ) : null;
}

export function AttachmentPicker({
  draft,
  disabled,
  supported,
  inputRef,
}: {
  draft: ReturnType<typeof useAttachmentDraft>;
  disabled: boolean;
  supported?: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <section className="desktop-attachment-picker">
      <div className="desktop-attachment-cards">
        {draft.items.map((item) => (
          <AttachmentCard
            key={item.id}
            item={item}
            disabled={disabled || draft.busy}
            onRemove={(target) => void draft.remove(target)}
          />
        ))}
      </div>
      <input
        ref={inputRef}
        hidden
        type="file"
        multiple
        aria-label="选择附件文件"
        disabled={disabled || draft.busy || !supported || !draft.online}
        onChange={(event) => {
          void draft.add([...(event.target.files ?? [])]);
          event.target.value = "";
        }}
      />
      {draft.error && <p role="alert">{draft.error}</p>}
      {draft.items.length > 0 && (
        <small>
          固定内容 · 每个4MiB · 最多5个 · Agent连接后校验媒体能力
        </small>
      )}
    </section>
  );
}
