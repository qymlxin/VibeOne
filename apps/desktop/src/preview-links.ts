/** 校验预览网页链接是否安全（仅允许无凭据的 HTTP/HTTPS 地址） */
export function previewUrl(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/** 将 Markdown 链接中的路径解析为工作区内相对路径 */
export function workspacePath(
  value: unknown,
  workspace?: string | null,
): string | null {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) {
    return null;
  }
  let target = value.trim();
  try {
    if (target.startsWith("file:")) {
      const url = new URL(target);
      if (url.hostname && url.hostname !== "localhost") {
        return null;
      }
      target = decodeURIComponent(url.pathname);
    } else {
      target = decodeURIComponent(
        (target.split("#")[0] ?? "").split("?")[0] ?? "",
      );
    }
  } catch {
    return null;
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(target)) {
    return null;
  }
  const root = String(workspace ?? "").replace(/\/$/, "");
  if (target.startsWith("/")) {
    if (!root || !target.startsWith(`${root}/`)) {
      return null;
    }
    target = target.slice(root.length + 1);
  }
  if (
    target.includes("\\") ||
    target.split("/").some((part) => part === "..")
  ) {
    return null;
  }
  target = target.replace(/^\.\//, "");
  return target && target !== "." ? target : null;
}

/** 将浏览器地址栏输入规整为可加载的 URL（支持本地地址与搜索词回退） */
export function browserAddress(value: unknown): string | null {
  const term = String(value ?? "").trim();
  if (!term) {
    return null;
  }
  if (/^https?:\/\//i.test(term)) {
    return previewUrl(term);
  }
  if (
    /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(term)
  ) {
    return previewUrl(`http://${term}`);
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(term)) {
    return null;
  }
  if (/^\/\//.test(term)) {
    return previewUrl(`https:${term}`);
  }
  if (
    /^[\w.-]+\.[a-z\d-]+(?::\d+)?(?:[/?#]|$)/i.test(term) &&
    !term.includes(" ")
  ) {
    return previewUrl(`https://${term}`);
  }
  return `https://www.baidu.com/s?wd=${encodeURIComponent(term)}`;
}
