// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).

/** A folder's path and a child's name. Native paths use `/` on macOS and Linux, and Rust's file
 * calls take `/` on Windows too. */
export function joinPath(dir: string, name: string): string {
  if (dir.endsWith("/") || dir.endsWith("\\")) return dir + name;
  return `${dir}/${name}`;
}

export function fileName(path: string): string {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index >= 0 ? path.slice(index + 1) : path;
}

export function parentPath(path: string): string {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index >= 0 ? path.slice(0, index) : path;
}

/** `root` and every folder from it down to `path`, or null when `path` is outside the tree. Tree
 * paths are built with joinPath, so below the root each name is `/`-separated. */
export function treeLineage(root: string, path: string): string[] | null {
  if (!root) return null;
  if (path === root) return [root];
  const prefix = joinPath(root, "");
  if (!path.startsWith(prefix)) return null;
  const lineage = [root];
  for (const name of path.slice(prefix.length).split("/")) {
    if (!name) return null;
    lineage.push(joinPath(lineage[lineage.length - 1], name));
  }
  return lineage;
}

/** Whether `path` is `dir` or lies under it. */
export function isUnder(path: string, dir: string): boolean {
  return path === dir || path.startsWith(`${dir}/`);
}
