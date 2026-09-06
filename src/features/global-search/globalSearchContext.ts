import type { GlobalSearchResult, GlobalSearchContextItem } from "./types";
export function globalSearchContext(
  results: GlobalSearchResult[],
  limit = 12,
): GlobalSearchContextItem[] {
  return results.slice(0, limit).map((result) => ({
    kind: result.kind,
    title: result.title,
    snippet: result.body.slice(0, 280),
    href: result.href,
    ...(result.spaceName ? { space: result.spaceName } : {}),
    source: result.source,
  }));
}
