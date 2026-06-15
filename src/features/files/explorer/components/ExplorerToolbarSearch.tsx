import { SystemErrorActivity } from "@/features/activity";
import { useSearchStore } from "@/features/files/search";
import { useExplorerStore } from "../store";
import { mergeHybridSearchResults, queryIndexedExplorerSearch, querySemanticExplorerSearch, semanticQueryMinimumCharacters } from "../utils/globalSearch";
import { SearchResultThumbnail } from "./SearchResultThumbnail";
import { ExplorerToolbarSearchView, type ExplorerToolbarSearchProps, type ExplorerToolbarSearchRuntime } from "./ExplorerToolbarSearchView";
export type { ExplorerToolbarSearchProps } from "./ExplorerToolbarSearchView";
const runtime: ExplorerToolbarSearchRuntime = {
  Error: SystemErrorActivity,
  Thumbnail: SearchResultThumbnail,
  openSearch: path => { void useSearchStore.getState().openSearch(path); },
  async query(query, currentPath, signal) {
    const options = { scope: "everything" as const, currentPath, limit: 8 };
    const [indexed, semantic] = await Promise.allSettled([
      queryIndexedExplorerSearch(query, options, useExplorerStore.getState().library),
      query.replace(/\s/g, "").length >= semanticQueryMinimumCharacters ? querySemanticExplorerSearch(query, options) : Promise.resolve([]),
    ]);
    if (signal.aborted) throw new DOMException("Search cancelled", "AbortError");
    const extra = semantic.status === "fulfilled" ? semantic.value : [];
    if (indexed.status === "rejected" && !extra.length) throw indexed.reason;
    return mergeHybridSearchResults(indexed.status === "fulfilled" ? indexed.value : [], extra, 8);
  },
};
export function ExplorerToolbarSearch(props: ExplorerToolbarSearchProps) {
  return <ExplorerToolbarSearchView {...props} runtime={runtime} />;
}
