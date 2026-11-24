interface MarkdownNode {
  type?: string;
  value?: string;
  children?: MarkdownNode[];
}

/** 保留段落内部的显式换行符，同时不将块级标签间的空白视作硬换行 */
export function remarkSoftBreaks() {
  return function transform(node: MarkdownNode): void {
    if (!Array.isArray(node.children)) {
      return;
    }
    node.children = node.children.flatMap((child) => {
      if (
        child.type === "text" &&
        typeof child.value === "string" &&
        child.value.includes("\n")
      ) {
        return child.value.split("\n").flatMap((value, index) => [
          ...(index ? [{ type: "break" }] : []),
          { type: "text", value },
        ]);
      }
      transform(child);
      return [child];
    });
  };
}
