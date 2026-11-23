// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).

const FILE_LINK_PROTOCOL = "misty-file:";

const SPACED_POSIX_FILE_PATH_PATTERN = String.raw`\/(?:Users|Volumes|home|tmp|var|private)\/[^\r\n\`"'<>]*?\.[A-Za-z0-9]{1,12}(?:#[A-Za-z0-9:_-]+)?`;
const WINDOWS_ABSOLUTE_PATH_PATTERN = String.raw`[A-Za-z]:[\\/](?![\\/])[^\s\`"'<>\|]+`;
const FILE_PATH_PATTERN = new RegExp(
  `(${[
    SPACED_POSIX_FILE_PATH_PATTERN,
    WINDOWS_ABSOLUTE_PATH_PATTERN,
    String.raw`\/[^\s\`"'<>]+`,
    String.raw`~\/[^\s\`"'<>]+`,
    String.raw`\.{1,2}\/[^\s\`"'<>]+`,
    String.raw`[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+`,
  ].join("|")})`,
);
const FILE_PATH_MATCH = new RegExp(`^${FILE_PATH_PATTERN.source}$`);
const WINDOWS_ABSOLUTE_PATH_MATCH = new RegExp(`^${WINDOWS_ABSOLUTE_PATH_PATTERN}$`);

const CJK_PATTERN = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]/;
const FILE_EXTENSION_PATTERN = /\.[A-Za-z0-9]+$/;
const RELATIVE_ALLOWED_PREFIXES = [
  "src/",
  "src-tauri/",
  "app/",
  "lib/",
  "tests/",
  "test/",
  "packages/",
  "apps/",
  "docs/",
  "scripts/",
];

function isPathCandidate(value: string) {
  if (WINDOWS_ABSOLUTE_PATH_MATCH.test(value)) return true;
  if (!value.includes("/")) return false;
  if (value.startsWith("//")) return false;
  if (CJK_PATTERN.test(value) && !FILE_EXTENSION_PATTERN.test(value.split("/").pop() ?? "")) {
    return false;
  }
  if (
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith("~/")
  ) {
    if (value.startsWith("/") && !value.slice(1).includes("/")) {
      const segment = value.slice(1);
      if (segment.includes(":") || !segment.includes(".")) return false;
    }
    return true;
  }
  const lastSegment = value.split("/").pop() ?? "";
  if (lastSegment.includes(".")) return true;
  return RELATIVE_ALLOWED_PREFIXES.some((prefix) => value.startsWith(prefix));
}

export function isLinkableFilePath(value: string) {
  const trimmed = stripFileLocation(value.trim());
  if (!trimmed || !FILE_PATH_MATCH.test(trimmed)) return false;
  return isPathCandidate(trimmed);
}

export function toFileLink(path: string) {
  return `${FILE_LINK_PROTOCOL}${encodeURIComponent(path)}`;
}

export function resolveFilePath(path: string, workspacePath: string): string | null {
  const deSlashed = path.trim().replace(/^\/+(?=[A-Za-z]:[\\/])/, "");
  const trimmed = percentDecodePath(stripFileLocation(deSlashed));
  if (!trimmed) return null;
  if (trimmed.startsWith("~/")) return null;
  if (trimmed.startsWith("/") || /^[A-Za-z]:[\\/]/.test(trimmed)) return trimmed;
  const relative = trimmed.replace(/^\.\//, "");
  if (trimmed.startsWith("../")) return null;
  const root = workspacePath.replace(/[/\\]+$/, "");
  return root ? `${root}/${relative}` : null;
}

function stripFileLocation(path: string): string {
  return path.replace(/(?::\d+(?::\d+)?|#L\d+(?:C\d+)?(?:-L?\d+(?:C\d+)?)?)$/i, "");
}

function percentDecodePath(path: string): string {
  if (!path.includes("%")) return path;
  try {
    const decoded = decodeURIComponent(path);
    return decoded === path ? path : decoded;
  } catch {
    return path;
  }
}
