import type {
  LibrarySearchOptions,
  ParsedLibraryQuery,
} from "@/models/interfaces/features/explorer/utils/librarySearch";
export type {
  LibrarySearchOptions,
  ParsedLibraryQuery,
} from "@/models/interfaces/features/explorer/utils/librarySearch";
import type {
  FileKind,
  SearchQueryScope,
  SearchSourceKind,
} from "@/models/types/services/misty-api";
import type {
  ExplorerLibraryItem,
  ExplorerLibrarySnapshot,
  ExplorerLocation,
  FileEntry,
  SearchResult,
} from "@/models/interfaces/services/misty-api";

export function mergeLibrarySearchResults(
  backendResults: SearchResult[],
  library: ExplorerLibrarySnapshot | null,
  query: string,
  options: LibrarySearchOptions = {},
): SearchResult[] {
  const merged = [...backendResults];
  const seen = new Set(backendResults.map((result) => normalizePath(result.entry.path)));
  for (const result of librarySearchResults(library, query, options)) {
    const key = normalizePath(result.entry.path);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(result);
  }
  return merged
    .sort(
      (left, right) => right.score - left.score || left.entry.name.localeCompare(right.entry.name),
    )
    .slice(0, options.limit ?? merged.length);
}

export function librarySearchResults(
  library: ExplorerLibrarySnapshot | null,
  query: string,
  options: LibrarySearchOptions = {},
): SearchResult[] {
  if (!library) return [];
  const parsed = parseLibraryQuery(query);
  if (parsed.terms.length === 0 && parsed.tags.length === 0 && parsed.comments.length === 0)
    return [];
  const limit = options.limit ?? 100;
  const indexedAtMs = Date.now();
  return libraryItems(library)
    .map((item) => scoreLibraryItem(item, parsed, options, indexedAtMs))
    .filter((result): result is SearchResult => Boolean(result))
    .sort(
      (left, right) => right.score - left.score || left.entry.name.localeCompare(right.entry.name),
    )
    .slice(0, limit);
}

function parseLibraryQuery(query: string): ParsedLibraryQuery {
  const parsed: ParsedLibraryQuery = { terms: [], tags: [], comments: [] };
  for (const token of query.match(/(?:tag|comment):"[^"]+"|"[^"]+"|\S+/gi) ?? []) {
    const value = unquoteLibraryQueryToken(token).trim().toLowerCase();
    if (!value) continue;
    if (value.startsWith("tag:")) parsed.tags.push(value.slice(4));
    else if (value.startsWith("comment:")) parsed.comments.push(value.slice(8));
    else parsed.terms.push(value);
  }
  return parsed;
}

function unquoteLibraryQueryToken(token: string): string {
  const prefixed = token.match(/^(tag|comment):"([^"]*)"$/i);
  if (prefixed) return `${prefixed[1].toLowerCase()}:${prefixed[2]}`;
  return token.replace(/^"|"$/g, "");
}

function scoreLibraryItem(
  item: ExplorerLibraryItem,
  query: ParsedLibraryQuery,
  options: LibrarySearchOptions,
  indexedAtMs: number,
): SearchResult | null {
  const sourceKind: SearchSourceKind = item.type === 1 ? "remote" : "local";
  if (options.scope === "local" && sourceKind !== "local") return null;
  if (options.scope === "remotes" && sourceKind !== "remote") return null;
  if (
    options.scope === "current" &&
    options.currentPath &&
    !normalizePath(item.path).startsWith(normalizePath(options.currentPath))
  )
    return null;

  const haystack = [item.name, item.path, item.mimeType, ...(item.tags ?? []), item.comments ?? ""]
    .join(" ")
    .toLowerCase();
  if (!query.terms.every((term) => haystack.includes(term))) return null;
  if (
    !query.tags.every((tag) =>
      (item.tags ?? []).some((candidate) => candidate.toLowerCase().includes(tag)),
    )
  )
    return null;
  if (!query.comments.every((comment) => (item.comments ?? "").toLowerCase().includes(comment)))
    return null;

  const tagBoost = query.tags.length > 0 ? 0.25 : 0;
  const commentBoost = query.comments.length > 0 ? 0.15 : 0;
  const nameBoost = query.terms.some((term) => item.name.toLowerCase().includes(term)) ? 0.2 : 0;
  return {
    entry: fileEntryFromLibraryItem(item, sourceKind),
    score: 0.72 + tagBoost + commentBoost + nameBoost,
    sourceKind,
    indexedAtMs,
  };
}

function libraryItems(library: ExplorerLibrarySnapshot): ExplorerLibraryItem[] {
  const items = new Map<string, ExplorerLibraryItem>();
  for (const item of [...library.recentFiles, ...library.starredFiles]) {
    if (!item.path) continue;
    const key = normalizePath(item.path);
    const existing = items.get(key);
    items.set(key, {
      ...item,
      tags: mergeStrings(existing?.tags ?? [], item.tags ?? []),
      comments: item.comments || existing?.comments || "",
    });
  }
  return [...items.values()];
}

function fileEntryFromLibraryItem(
  item: ExplorerLibraryItem,
  sourceKind: SearchSourceKind,
): FileEntry {
  const kind: FileKind = item.isDir ? "folder" : "file";
  const extension = item.name.includes(".") ? item.name.slice(item.name.lastIndexOf(".")) : "";
  const location: ExplorerLocation =
    sourceKind === "remote"
      ? { kind: "remote", providerType: null, remoteName: null, remotePath: item.path }
      : { kind: "local", providerType: null, remoteName: null, remotePath: null };
  return {
    id: item.id || item.path,
    name: item.name || item.path.split("/").filter(Boolean).pop() || item.path,
    path: item.path,
    extension,
    mimeType: item.mimeType || null,
    remoteModified: null,
    kind,
    sizeBytes: item.isDir ? null : item.size,
    modifiedMs: Date.parse(item.lastModified) || null,
    createdMs: null,
    readonly: false,
    hidden: false,
    isDeleted: false,
    location,
  };
}

function mergeStrings(left: string[], right: string[]): string[] {
  const merged: string[] = [];
  for (const value of [...left, ...right]) {
    if (!value || merged.includes(value)) continue;
    merged.push(value);
  }
  return merged;
}

function normalizePath(path: string | null | undefined): string {
  const normalized = (path ?? "").replace(/\/+$/, "");
  return normalized || "/";
}
