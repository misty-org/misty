import { isLeaf, type MemoryNode, ROOT_ID } from "./model";

export interface VisibleNode {
  id: string;
  parent: string | null;
  /** The server's node; the Space root has none. */
  node: MemoryNode | null;
  depth: number;
}

/** Filters name a branch or group by id, and a whole source as `source:<name>`. */
export function isHidden(node: MemoryNode, hidden: ReadonlySet<string>): boolean {
  if (hidden.has(node.id)) return true;
  return node.type === "group" && Boolean(node.source) && hidden.has(`source:${node.source}`);
}

function duplicateKey(node: MemoryNode): string {
  const normalize = (value: string | undefined) =>
    (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  const timestamp = node.last_at ? new Date(node.last_at).getTime() : Number.NaN;
  const minute = Number.isFinite(timestamp) ? Math.floor(timestamp / 60_000) : "";
  return JSON.stringify([
    node.type,
    normalize(node.label),
    normalize(node.detail),
    node.count,
    node.source ?? "",
    node.url ?? "",
    normalize(node.text || node.preview),
    minute,
  ]);
}

/**
 * The nodes the canvas shows: the Space, its branches, and the children of every
 * expanded node that has been loaded, minus what the filters hide. Children are keyed by
 * their parent's id; the branches are keyed by "".
 */
export function visibleTree(
  children: Readonly<Record<string, MemoryNode[]>>,
  expanded: ReadonlySet<string>,
  hidden: ReadonlySet<string>,
): VisibleNode[] {
  const out: VisibleNode[] = [{ id: ROOT_ID, parent: null, node: null, depth: 0 }];
  const walk = (key: string, parent: string, depth: number) => {
    const seen = new Set<string>();
    for (const node of children[key] ?? []) {
      if (isHidden(node, hidden)) continue;
      const duplicate = isLeaf(node) ? duplicateKey(node) : node.id;
      if (seen.has(duplicate)) continue;
      seen.add(duplicate);
      out.push({ id: node.id, parent, node, depth });
      if (expanded.has(node.id)) walk(node.id, node.id, depth + 1);
    }
  };
  walk("", ROOT_ID, 1);
  return out;
}
