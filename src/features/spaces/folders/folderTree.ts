import type { FolderScan } from "./folderNative";

/** One file or folder in the share dialog's tree. */
export interface FolderNode {
  name: string;
  /** Inside the shared folder, `/` between parts, with no trailing slash. */
  path: string;
  dir: boolean;
  /** Left out by `.gitignore` or `.mistyignore`. */
  excluded: boolean;
  /** The shared bytes in it. */
  size: number;
  children: FolderNode[];
}

/** The scan as a tree, folders first and each level by name. */
export function buildTree(scan: FolderScan): FolderNode[] {
  const root: FolderNode = {
    name: "",
    path: "",
    dir: true,
    excluded: false,
    size: 0,
    children: [],
  };
  const dirs = new Map<string, FolderNode>([["", root]]);
  const folderFor = (parts: string[]): FolderNode => {
    let node = root;
    for (let index = 0; index < parts.length; index++) {
      const path = parts.slice(0, index + 1).join("/");
      let next = dirs.get(path);
      if (!next) {
        next = { name: parts[index]!, path, dir: true, excluded: false, size: 0, children: [] };
        dirs.set(path, next);
        node.children.push(next);
      }
      node = next;
    }
    return node;
  };
  for (const file of scan.included) {
    const parts = file.path.split("/");
    const name = parts.pop()!;
    const parents = parts.map((_, index) => parts.slice(0, index + 1).join("/"));
    folderFor(parts).children.push({
      name,
      path: file.path,
      dir: false,
      excluded: false,
      size: file.size,
      children: [],
    });
    root.size += file.size;
    for (const parent of parents) dirs.get(parent)!.size += file.size;
  }
  for (const entry of scan.excluded) {
    const dir = entry.endsWith("/");
    const path = dir ? entry.slice(0, -1) : entry;
    const parts = path.split("/");
    const name = parts.pop()!;
    const parent = folderFor(parts);
    const existing = dir ? dirs.get(path) : undefined;
    if (existing) {
      existing.excluded = true;
      continue;
    }
    const node: FolderNode = { name, path, dir, excluded: true, size: 0, children: [] };
    if (dir) dirs.set(path, node);
    parent.children.push(node);
  }
  const sort = (nodes: FolderNode[]) => {
    nodes.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
    for (const node of nodes) sort(node.children);
  };
  sort(root.children);
  return root.children;
}

/** The rows shown with `expanded` folders open, each with how deep it sits. */
export function visibleRows(
  nodes: FolderNode[],
  expanded: ReadonlySet<string>,
  depth = 0,
  out: { node: FolderNode; depth: number }[] = [],
): { node: FolderNode; depth: number }[] {
  for (const node of nodes) {
    out.push({ node, depth });
    if (node.dir && !node.excluded && expanded.has(node.path))
      visibleRows(node.children, expanded, depth + 1, out);
  }
  return out;
}

/** How many files and bytes the tree shares. */
export function sharedTotals(scan: FolderScan): { files: number; bytes: number } {
  return {
    files: scan.included.length,
    bytes: scan.included.reduce((sum, file) => sum + file.size, 0),
  };
}

/** A path as one `.mistyignore` rule anchored at the folder: `/docs/`, `/notes\*.md`. */
function ruleFor(node: FolderNode): string {
  const escaped = node.path
    .replace(/[\\*?[]/g, (char) => `\\${char}`)
    .replace(/ +$/, (spaces) => spaces.split(" ").join("\\ "));
  return `/${escaped}${node.dir ? "/" : ""}`;
}

function withLine(text: string, line: string): string {
  const body = text.replace(/\s+$/, "");
  return body ? `${body}\n${line}\n` : `${line}\n`;
}

function withoutLine(text: string, line: string): string {
  const kept = text.split("\n").filter((each) => each.trim() !== line);
  return kept.join("\n");
}

/**
 * `.mistyignore` after a checkbox changes. Leaving a thing out takes back a `!` rule the dialog
 * wrote for it, else adds a rule. Taking it back in removes the dialog's rule for it, else adds
 * `!rule`, which wins over `.gitignore`.
 */
export function toggledIgnore(text: string, node: FolderNode, include: boolean): string {
  const rule = ruleFor(node);
  const lines = new Set(text.split("\n").map((line) => line.trim()));
  if (include) return lines.has(rule) ? withoutLine(text, rule) : withLine(text, `!${rule}`);
  return lines.has(`!${rule}`) ? withoutLine(text, `!${rule}`) : withLine(text, rule);
}
