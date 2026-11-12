// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import type { DirEntry, FileTreeColor, RepositorySummary } from "./filesApi";
import { fileName, joinPath } from "./paths";
import { nextChainDir } from "./treeChain";

export interface VisibleNode extends DirEntry {
  path: string;
  /** Every folder a merged single-child row stands for, top first. */
  compactPaths?: string[];
  depth: number;
  expanded: boolean;
  loading: boolean;
  /** The branch and counts when this folder is itself the top of a repository. */
  repository?: RepositorySummary;
  /** The name's Git color: a file's state, or blue for a repository's top folder. */
  color?: FileTreeColor;
}

/** The store slices the visible row list is derived from. */
export interface TreeSnapshot {
  root: string;
  children: Record<string, DirEntry[]>;
  expanded: Record<string, true>;
  loadingDirs: Record<string, true>;
  dirErrors: Record<string, string>;
  repositories: Record<string, RepositorySummary>;
  fileColors: Record<string, Record<string, FileTreeColor>>;
  /** Drop entries Git ignores (and, with them, everything beneath). */
  hideIgnored: boolean;
}

/** Flatten the expanded tree into rows, depth-first in listing order. */
export function buildVisibleNodes({
  root,
  children,
  expanded,
  loadingDirs,
  dirErrors,
  repositories,
  fileColors,
  hideIgnored,
}: TreeSnapshot): VisibleNode[] {
  if (!root) return [];
  const out: VisibleNode[] = [];
  // Synthetic root row: the workspace root itself is the first tree row
  // with its repository badge (`misty main M1 ?12`); clicking
  // it expands the tree below it. Never hidden, whatever Git says.
  out.push({
    name: fileName(root),
    isDir: true,
    size: 0,
    mtimeMs: 0,
    path: root,
    depth: 0,
    expanded: !!expanded[root],
    loading: !!loadingDirs[root],
    repository: repositories[root],
    // Repo-root rows are blue (the workspace repo root row here; nested
    // repo dirs get theirs from the backend color pass).
    color: repositories[root] ? "repository" : undefined,
  });
  const chain = { children, loadingDirs, dirErrors, repositories, hideIgnored };
  const walk = (dirPath: string, depth: number) => {
    const entries = children[dirPath];
    if (!entries) return;
    for (const e of entries) {
      if (hideIgnored && e.ignored) continue;
      let parent = dirPath;
      let leaf = e.name;
      let path = joinPath(dirPath, e.name);
      let name = e.name;
      const compactPaths = [path];
      let next = e.isDir ? nextChainDir(path, !!e.ignored, chain) : null;
      while (next) {
        parent = path;
        leaf = next.name;
        name += `/${next.name}`;
        path = joinPath(path, next.name);
        compactPaths.push(path);
        next = nextChainDir(path, !!e.ignored, chain);
      }
      const isExpanded = compactPaths.every((part) => !!expanded[part]);
      out.push({
        ...e,
        name,
        path,
        compactPaths: compactPaths.length > 1 ? compactPaths : undefined,
        depth,
        expanded: e.isDir && isExpanded,
        loading: e.isDir && !!loadingDirs[path],
        repository: e.isDir ? repositories[path] : undefined,
        // Plain folders never carry color; files take their git state;
        // nested repo dirs take their own repo's status color from the
        // backend. Blue stays exclusive to the workspace root row. A merged
        // row takes its last folder's color (a nested repo ends a chain).
        color: fileColors[parent]?.[leaf],
      });
      // Only already-expanded levels are walked. Listing requests belong to
      // the click handler, which follows a single chain when needed.
      if (e.isDir && isExpanded) walk(path, depth + 1);
    }
  };
  if (expanded[root]) walk(root, 1);
  return out;
}
