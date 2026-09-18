import type { ExplorerSearchOptions } from "../../model/interfaces/utils/globalSearch";

export function pathAllowed(
  path: string,
  sourceKind: "local" | "cloud",
  options: ExplorerSearchOptions,
): boolean {
  if (options.includeHidden === false && baseName(path).startsWith(".")) return false;
  if (options.scope === "local" && sourceKind !== "local") return false;
  if (options.scope === "remotes" && sourceKind !== "cloud") return false;
  if (options.scope === "current" && options.currentPath)
    return isPathWithin(path, options.currentPath);
  return true;
}

export function isPathWithin(path: string, root: string): boolean {
  const candidate = normalizePath(path);
  const normalizedRoot = normalizePath(root);
  return (
    candidate === normalizedRoot ||
    candidate.startsWith(normalizedRoot === "/" ? "/" : `${normalizedRoot}/`)
  );
}

export function normalizePath(path: string): string {
  const normalized = path
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/\/$/, "");
  return normalized || "/";
}

export function joinPath(root: string, relative: string): string {
  const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return `${root.replace(/[\\/]+$/, "")}${separator}${relative.replace(/^[\\/]+/, "")}`;
}

export function baseName(path: string): string {
  return normalizePath(path).split("/").filter(Boolean).pop() ?? path;
}

export function extensionOf(name: string): string {
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(index) : "";
}

export function nonWhitespaceLength(value: string): number {
  return value.replace(/\s/g, "").length;
}

export function clampLimit(value: number): number {
  return Math.max(1, Math.min(500, Math.floor(value)));
}

export function semanticCacheKey(
  query: string,
  options: ExplorerSearchOptions,
  limit: number,
): string {
  return JSON.stringify([
    query.toLocaleLowerCase(),
    options.scope ?? "everything",
    options.scope === "current" ? normalizePath(options.currentPath ?? "/") : "",
    limit,
  ]);
}

export function finiteScore(...values: unknown[]): number {
  for (const value of values) {
    const numeric = optionalFiniteNumber(value);
    if (numeric !== null) return numeric;
  }
  return 0;
}

export function optionalFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? uniqueStrings(
        value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())),
      )
    : [];
}

export function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
