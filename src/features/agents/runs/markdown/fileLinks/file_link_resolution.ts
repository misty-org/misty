// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { findFiles } from "../../../engines/engines_api";
import { projectApi } from "../../../context-panel/project_api";
import { resolveFilePath } from "./file_links";

function pathKey(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function isUnder(path: string, root: string): boolean {
  const base = pathKey(root);
  const target = pathKey(path);
  return base.length > 0 && (target === base || target.startsWith(`${base}/`));
}

function parentPath(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return index <= 0 ? trimmed.slice(0, index + 1) : trimmed.slice(0, index);
}

function fileName(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  return trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1);
}

async function existsInParent(candidate: string): Promise<boolean> {
  const parent = parentPath(candidate);
  const name = fileName(candidate);
  if (!parent || !name || parent === candidate) return false;
  try {
    const entries = await projectApi.listDir(parent);
    const wanted = name.toLowerCase();
    return entries.some((entry) => entry.name.toLowerCase() === wanted);
  } catch {
    return false;
  }
}

function matchBySuffix(entries: { relative: string; path: string }[], key: string) {
  const wanted = key.toLowerCase();
  const matches = entries.filter((entry) => {
    const relative = pathKey(entry.relative);
    return relative === wanted || relative.endsWith(`/${wanted}`);
  });
  return matches.length === 1 ? matches[0] : null;
}

async function findByIndex(root: string, relative: string): Promise<string | null> {
  const segments = relative.split("/").filter(Boolean);
  if (segments.length === 0) return null;
  const keys = segments.length > 1 ? [relative, segments[segments.length - 1]] : [relative];
  let entries: { relative: string; path: string; isDir: boolean }[];
  try {
    entries = await findFiles(root, segments[segments.length - 1]);
  } catch {
    return null;
  }
  const files = entries.filter((entry) => !entry.isDir);
  for (const key of keys) {
    const match = matchBySuffix(files, key);
    if (match) return match.path;
  }
  return null;
}

export async function resolveChatFileLink(
  rawPath: string,
  workspacePath: string,
): Promise<string | null> {
  const candidate = resolveFilePath(rawPath, workspacePath);
  if (!candidate) return null;
  const root = workspacePath.trim();
  if (!root || !isUnder(candidate, root)) return candidate;
  if (await existsInParent(candidate)) return candidate;
  const trimmedRoot = root.replace(/\\/g, "/").replace(/\/+$/, "");
  const relative = candidate.replace(/\\/g, "/").slice(trimmedRoot.length).replace(/^\/+/, "");
  return (await findByIndex(root, relative)) ?? candidate;
}
