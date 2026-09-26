import { buildLocalIndex, searchDocuments } from "./globalSearchDocuments";
import type { GlobalSearchResult } from "./types";
import { useGlobalSearchStore } from "./useGlobalSearchStore";

/**
 * Searches the signed-in account's content already on this device, such as
 * notes, Spaces and Library items. Synchronous and local only: nothing is
 * sent anywhere, so other surfaces (like the browser address bar) can call
 * it on every keystroke. Files are left out; they open through Files.
 */
export function searchLocalMistyContent(query: string, limit: number): GlobalSearchResult[] {
  const accountId = useGlobalSearchStore.getState().accountId;
  if (!accountId || !query.trim()) return [];
  return searchDocuments(buildLocalIndex(accountId), query, limit + 4)
    .filter((result) => result.kind !== "file" && result.kind !== "folder" && !result.fileResult)
    .slice(0, limit);
}
