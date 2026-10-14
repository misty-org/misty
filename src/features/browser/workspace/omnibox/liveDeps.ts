import { bookmarks } from "@/features/bookmarks/library";
import { invoke } from "@tauri-apps/api/core";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { searchLocalMistyContent } from "@/features/global-search/localContentSearch";
import { buildLocalIndex } from "@/features/global-search/globalSearchDocuments";
import { useGlobalSearchStore } from "@/features/global-search/useGlobalSearchStore";
import { useWorkspaceStore } from "@/features/workspace";
import { openBrowserTabs } from "@/features/workspace/browserTabs";
import {
  browserSearchEngine,
  browserSearchSuggestionsEnabled,
  browserSearchUrl,
} from "@/features/workspace/browserSearchEngine";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { browserLibrary } from "../../library/native";
import type { OmniboxDeps } from "./providers";
import type { SearchSuggestion } from "./providers/deps";
import { prepareBookmarks } from "./providers/bookmarks";

type BookmarkRecords = ReturnType<typeof useWorkspaceStore.getState>["bookmarks"];
let lastBookmarks: { records: BookmarkRecords; list: { url: string; title: string }[] } | undefined;

/** One list per set of bookmark records, so the provider's parsed addresses stay cached. */
function bookmarkList(records: BookmarkRecords) {
  if (lastBookmarks?.records !== records)
    lastBookmarks = {
      records,
      list: bookmarks(records).map(({ url, title }) => ({ url, title })),
    };
  return lastBookmarks.list;
}

/**
 * The address bar's real sources. Everything is read at query time, so
 * providers see the latest synced workspace and settings without
 * subscriptions, and the omnibox never writes to them.
 */
export const liveOmniboxDeps: OmniboxDeps = {
  searchEngine: browserSearchEngine,
  searchUrl: browserSearchUrl,
  searchSuggestionsEnabled: () => hasTauriInternals() && browserSearchSuggestionsEnabled(),
  fetchSearchSuggestions: (engine, text) =>
    invoke<SearchSuggestion[]>("browser_search_suggest", { request: { engine, text } }),
  historySuggestions: (request) =>
    hasTauriInternals() ? browserLibrary.historySuggestions(request) : Promise.resolve([]),
  recentVisits: (request) =>
    hasTauriInternals() ? browserLibrary.history(request) : Promise.resolve([]),
  bookmarks: () => bookmarkList(useWorkspaceStore.getState().bookmarks),
  mistyContent: (text, limit) =>
    searchLocalMistyContent(text, limit).map((result) => ({
      id: result.canonicalId ?? `${result.kind}:${result.id}`,
      title: result.title,
      detail: result.spaceName ? `${result.kind} · ${result.spaceName}` : result.kind,
      route: result.href,
    })),
  clipboardUrl: () => (hasTauriInternals() ? readText() : Promise.resolve(null)),
  openTabs: openBrowserTabs,
};

/**
 * Builds the caches the first keystroke would otherwise pay for (parsed
 * bookmark addresses and the local content index). Call when a search box
 * mounts or opens; the work waits for idle time, and caches that are already
 * current cost nothing.
 */
export function warmOmniboxCaches(): () => void {
  const warm = () => {
    prepareBookmarks(bookmarkList(useWorkspaceStore.getState().bookmarks));
    const accountId = useGlobalSearchStore.getState().accountId;
    if (accountId) buildLocalIndex(accountId);
  };
  // No deadline: forcing the work to run could land it between keystrokes.
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(warm);
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(warm, 0);
  return () => window.clearTimeout(id);
}
