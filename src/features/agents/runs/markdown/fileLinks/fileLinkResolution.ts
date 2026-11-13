// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { findFiles } from "../../../engines/enginesApi";
import { projectApi } from "../../../context-panel/projectApi";
import { resolveFilePath } from "./fileLinks";

/**
 * Canonical form for comparing two paths: forward slashes (Windows accepts either), no trailing
 * separator, lower case (Windows filesystems ignore case). Only for comparing, never for paths
 * handed back.
 */
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

/** Cheap existence check: the candidate's folder lists its name (case-insensitively). */
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

/** `release/app.exe` must not silently bind to `dist/app.exe`: only an unambiguous suffix counts. */
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
  // Longest suffix first; a bare file name only last, and only when it is unambiguous.
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

/**
 * The path on disk a reply's file link means.
 *
 * `resolveFilePath` anchors a relative link at the chat's folder and passes absolute links
 * through. That misses the common layout where the linked folder is an outer folder and the
 * project sits inside it: `release/app.exe` resolves to `…/release/app.exe`, which doesn't exist,
 * though the file is right there further down.
 *
 * Two fallbacks, both only for candidates inside the folder (probing anywhere else would only
 * be refused): list the candidate's folder and keep it when its name shows up; otherwise match
 * the link's end against the folder's files, longest unambiguous suffix first.
 *
 * Returns the plain candidate when nothing better turns up, and null for what isn't a file path
 * at all (`~/`, `../`, empty).
 */
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
