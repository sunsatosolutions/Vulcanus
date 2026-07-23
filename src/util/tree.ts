interface TreeNode {
  name: string;
  children: Map<string, TreeNode>;
}

function insert(root: TreeNode, segments: string[]): void {
  let cursor = root;
  for (const segment of segments) {
    let next = cursor.children.get(segment);
    if (!next) {
      next = { name: segment, children: new Map() };
      cursor.children.set(segment, next);
    }
    cursor = next;
  }
}

function render(node: TreeNode, prefix: string, lines: string[]): void {
  const entries = [...node.children.values()];
  entries.forEach((child, index) => {
    const isLast = index === entries.length - 1;
    lines.push(`${prefix}${isLast ? "└─" : "├─"} ${child.name}`);
    if (child.children.size > 0) {
      render(child, `${prefix}${isLast ? "   " : "│  "}`, lines);
    }
  });
}

/** ASCII tree used inside the generated Index note. */
export function renderTree(rootName: string, paths: string[]): string {
  const root: TreeNode = { name: rootName, children: new Map() };
  for (const path of paths) insert(root, path.split("/"));
  const lines: string[] = [rootName];
  render(root, "", lines);
  return lines.join("\n");
}
