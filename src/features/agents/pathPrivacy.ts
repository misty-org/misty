import type { MikaServerContext } from "@/models/interfaces/features/agents/pathPrivacy";
export type { MikaServerContext } from "@/models/interfaces/features/agents/pathPrivacy";
/** Build the only path context that may cross the device/server boundary. */
export function mikaServerContext(
  localRoot: string | null,
  localSelectedPaths: string[],
  opaqueScopeId: string | null,
): MikaServerContext {
  return {
    activeRoot: opaqueScopeId || undefined,
    selectedPaths: localRoot
      ? localSelectedPaths
          .map((path) => deviceRelativePath(localRoot, path))
          .filter((path): path is string => Boolean(path))
      : [],
  };
}

/** Returns a safe relative path only when `path` is inside `root`. */
export function deviceRelativePath(root: string, path: string): string | null {
  const normalizedRoot = normalizeDevicePath(root).replace(/\/+$/, "");
  const normalizedPath = normalizeDevicePath(path);
  const comparisonRoot = isWindowsPath(normalizedRoot)
    ? normalizedRoot.toLowerCase()
    : normalizedRoot;
  const comparisonPath = isWindowsPath(normalizedRoot)
    ? normalizedPath.toLowerCase()
    : normalizedPath;
  if (!normalizedRoot || comparisonPath === comparisonRoot) return null;
  if (!comparisonPath.startsWith(`${comparisonRoot}/`)) return null;
  const relative = normalizedPath.slice(normalizedRoot.length + 1);
  return isSafeRelativePath(relative) ? relative : null;
}

export function isSafeRelativePath(path: string): boolean {
  const normalized = path.trim().replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) return false;
  return normalized.split("/").every((part) => Boolean(part) && part !== "." && part !== "..");
}

function normalizeDevicePath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/");
}

function isWindowsPath(path: string): boolean {
  return /^[a-zA-Z]:\//.test(path);
}
