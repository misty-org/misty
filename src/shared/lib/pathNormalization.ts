const windowsDrivePathPattern = /^[A-Za-z]:[\\/]/;
const windowsDriveRootPattern = /^[A-Za-z]:\/$/;
const windowsUncPathPattern = /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+/;
const urlLikePathPattern = /^[A-Za-z][A-Za-z\d+.-]*:\/\//;

export function normalizeExplorerPath(path: string): string {
  const trimmed = stripWindowsVerbatimPrefix(path.trim());
  if (!trimmed) return "";

  const windowsPath =
    windowsDrivePathPattern.test(trimmed) ||
    windowsUncPathPattern.test(trimmed) ||
    trimmed.includes("\\");
  if (!windowsPath && urlLikePathPattern.test(trimmed)) return trimmed.replace(/\/+$/, "");

  let normalized = windowsPath ? trimmed.replace(/\\/g, "/") : trimmed;
  if (windowsPath && normalized.startsWith("//")) {
    normalized = `//${normalized.slice(2).replace(/\/{2,}/g, "/")}`;
  } else if (windowsPath) {
    normalized = normalized.replace(/\/{2,}/g, "/");
  }

  if (windowsDrivePathPattern.test(normalized)) {
    normalized = `${normalized[0].toUpperCase()}${normalized.slice(1)}`;
  }
  if (normalized === "/" || windowsDriveRootPattern.test(normalized)) return normalized;

  normalized = normalized.replace(/\/+$/, "");
  return normalized || "/";
}

function stripWindowsVerbatimPrefix(path: string): string {
  const uncMatch = path.match(/^(?:\\\\|\/\/)\?[/\\]UNC[/\\](.+)$/i);
  if (uncMatch?.[1]) return `//${uncMatch[1]}`;

  const driveMatch = path.match(/^(?:\\\\|\/\/)\?[/\\]([A-Za-z]:)(?:[/\\](.*))?$/);
  if (!driveMatch?.[1]) return path;

  const drive = driveMatch[1];
  const rest = driveMatch[2] ?? "";
  return rest ? `${drive}/${rest}` : `${drive}/`;
}

export function explorerPathKey(path: string): string {
  const normalized = normalizeExplorerPath(path);
  return isWindowsExplorerPath(normalized) ? normalized.toLocaleLowerCase() : normalized;
}

export function isWindowsExplorerPath(path: string): boolean {
  return windowsDrivePathPattern.test(path) || windowsUncPathPattern.test(path);
}

export function explorerPathName(path: string): string {
  const normalized = normalizeExplorerPath(path);
  return normalized.split("/").filter(Boolean).pop() || normalized;
}

export function joinExplorerPath(root: string, ...parts: string[]): string {
  const normalizedRoot = normalizeExplorerPath(root);
  if (!normalizedRoot) return normalizeExplorerPath(parts.join("/"));
  const suffix = parts
    .map((part) => part.replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
  if (!suffix) return normalizedRoot;
  const separator = normalizedRoot.endsWith("/") ? "" : "/";
  return normalizeExplorerPath(`${normalizedRoot}${separator}${suffix}`);
}
