import { invoke } from "@tauri-apps/api/core";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { searchLocalMistyContent } from "@/features/global-search/localContentSearch";
import { allLayoutViews, parseBrowserTabState, useWorkspaceStore } from "@/features/workspace";
import { currentVirtualWindows } from "@/features/workspace/virtualWindows";
import {
  browserSearchEngine,
  browserSearchSuggestionsEnabled,
  browserSearchUrl,
} from "@/features/workspace/browserSearchEngine";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { browserLibrary } from "../../library/native";
import type { OmniboxDeps } from "./providers";

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
    invoke<string[]>("browser_search_suggest", { request: { engine, text } }),
  historySuggestions: (request) =>
    hasTauriInternals() ? browserLibrary.historySuggestions(request) : Promise.resolve([]),
  bookmarks: () =>
    useWorkspaceStore
      .getState()
      .savedWebsites.map((website) => ({ url: website.fields.url, title: website.fields.title })),
  mistyContent: (text, limit) =>
    searchLocalMistyContent(text, limit).map((result) => ({
      id: result.canonicalId ?? `${result.kind}:${result.id}`,
      title: result.title,
      detail: result.spaceName ? `${result.kind} · ${result.spaceName}` : result.kind,
      route: result.href,
    })),
  clipboardUrl: () => (hasTauriInternals() ? readText() : Promise.resolve(null)),
  openTabs: () =>
    // The same windows `focusTab` can switch to.
    currentVirtualWindows(useWorkspaceStore.getState())
      .flatMap((window) => allLayoutViews(window.layout))
      .filter((tab) => tab.surfaceId === "browser")
      .map((tab) => {
        const state = parseBrowserTabState(tab.state);
        return {
          tabId: tab.id,
          url: state.url,
          title: tab.title,
          profileId: state.profileId,
          private: Boolean(state.private),
          agentOwned: Boolean(state.agentOwned),
        };
      }),
};
