import type { SearchResult } from "@/native/contracts";
export const semanticCache = new Map<string, { expiresAt: number; results: SearchResult[] }>();
export const semanticInFlight = new Map<string, Promise<SearchResult[]>>();
export const semanticCacheVersion = { generation: 0 };
export function clearSemanticExplorerSearchCache() {
  semanticCacheVersion.generation += 1;
  semanticCache.clear();
  semanticInFlight.clear();
}
