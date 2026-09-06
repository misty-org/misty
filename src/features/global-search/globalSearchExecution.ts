import { useSpacesStore } from "@/features/spaces";
import { globalMistyError } from "./globalMistyActions";
import { globalMistyApi } from "./globalMistyApi";
import {
  buildLocalIndex,
  fuseRankedResults,
  searchDocuments,
  searchServerTasks,
} from "./globalSearchDocuments";
import { searchResultMatchesFilters } from "./globalSearchStoreHelpers";
import type { GlobalSearchGet, GlobalSearchSet } from "./globalSearchStoreHelpers";
import type { GlobalSearchDocument, GlobalSearchResult } from "./types";

export async function executeGlobalSearch(
  set: GlobalSearchSet,
  get: GlobalSearchGet,
  query: string,
) {
  const trimmed = query.trim();
  const accountId = get().accountId;
  const requestId = get().requestId + 1;
  if (!trimmed || !accountId) {
    set({ results: [], searching: false, enriched: false, error: null, requestId });
    return;
  }
  const filters = get().filters;
  const local = searchDocuments(buildLocalIndex(accountId), trimmed, 24).filter((result) =>
    searchResultMatchesFilters(result, filters),
  );
  set({ results: local, searching: true, enriched: false, error: null, requestId });
  if (trimmed.length < 2) {
    set({ searching: false });
    return;
  }
  const spaces = useSpacesStore.getState().spaces;
  const requests: Array<Promise<GlobalSearchDocument[]>> = [];
  if (filters.source !== "device") {
    requests.push(
      globalMistyApi
        .search(trimmed, filters)
        .then((response) => response.hits)
        .catch(() => searchServerTasks(accountId, trimmed, spaces)),
    );
  }
  const settled = await Promise.allSettled(requests);
  if (get().requestId !== requestId || get().accountId !== accountId) return;
  const rankedLists = settled.flatMap((result) => {
    if (result.status !== "fulfilled") return [];
    const filtered = result.value.filter((document) =>
      searchResultMatchesFilters(document, filters),
    );
    const ranked = filtered.every(
      (document) => typeof (document as GlobalSearchResult).score === "number",
    )
      ? (filtered as GlobalSearchResult[])
      : searchDocuments(filtered, trimmed, 36);
    return [ranked];
  });
  const failures = settled.filter((result) => result.status === "rejected").length;
  set({
    results: fuseRankedResults([local, ...rankedLists], 36),
    searching: false,
    enriched: settled.some((result) => result.status === "fulfilled"),
    error:
      failures === settled.length ? "Server search is unavailable. Showing local results." : null,
  });
}

export async function executeGlobalVisualSearch(
  set: GlobalSearchSet,
  get: GlobalSearchGet,
  attachmentId: string,
  query = "",
) {
  const accountId = get().accountId;
  const requestId = get().requestId + 1;
  if (!accountId || !attachmentId) return;
  set({ searching: true, error: null, requestId, results: [] });
  try {
    const response = await globalMistyApi.visualSearch(attachmentId, query);
    if (get().accountId !== accountId || get().requestId !== requestId) return;
    const results = response.hits.filter((document) =>
      searchResultMatchesFilters(document, get().filters),
    );
    set({ results, searching: false, enriched: true });
  } catch (error) {
    if (get().accountId === accountId && get().requestId === requestId) {
      set({ searching: false, error: globalMistyError(error) });
    }
  }
}
