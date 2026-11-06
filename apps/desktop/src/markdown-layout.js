// Preserve intentional paragraph-internal line breaks without preserving HTML
// formatting whitespace between Markdown blocks. Code nodes have no children.
export function remarkSoftBreaks() {
  return function transform(node) {
    if (!Array.isArray(node.children)) return;
    node.children=node.children.flatMap(child=>{
      if (child.type==='text' && child.value.includes('\n')) {
        return child.value.split('\n').flatMap((value,index)=>[
          ...(index?[{type:'break'}]:[]),{type:'text',value},
        ]);
      }
      transform(child);
      return [child];
    });
  };
}
