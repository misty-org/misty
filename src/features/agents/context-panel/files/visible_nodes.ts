// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import type { DirEntry, FileTreeColor, RepositorySummary } from "./files_api";
import { fileName, joinPath } from "./paths";
import { nextChainDir } from "./tree_chain";

export interface VisibleNode extends DirEntry {
  path: string;
  compactPaths?: string[];
  depth: number;
  expanded: boolean;
  loading: boolean;
  error?: string;
  repository?: RepositorySummary;
  color?: FileTreeColor;
}

export interface TreeSnapshot {
  root: string;
  children: Record<string, DirEntry[]>;
  expanded: Record<string, true>;
  loadingDirs: Record<string, true>;
  dirErrors: Record<string, string>;
  repositories: Record<string, RepositorySummary>;
  fileColors: Record<string, Record<string, FileTreeColor>>;
  hideIgnored: boolean;
}

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
  out.push({
    name: fileName(root),
    isDir: true,
    size: 0,
    mtimeMs: 0,
    path: root,
    depth: 0,
    expanded: !!expanded[root],
    loading: !!loadingDirs[root],
    error: dirErrors[root],
    repository: repositories[root],
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
        error: e.isDir ? dirErrors[path] : undefined,
        repository: e.isDir ? repositories[path] : undefined,
        color: fileColors[parent]?.[leaf],
      });
      if (e.isDir && isExpanded) walk(path, depth + 1);
    }
  };
  if (expanded[root]) walk(root, 1);
  return out;
}
