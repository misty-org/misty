import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

export type SearchSuggestion =
  | { kind: "query"; text: string }
  | { kind: "site"; text: string; url: string };

export const useWebSearch = create<{ suggestions: boolean }>(() => ({ suggestions: false }));

export function configureWebSearch(settings: { suggestions: boolean }) {
  useWebSearch.setState({ suggestions: settings.suggestions });
}

export function fetchSuggestions(text: string): Promise<SearchSuggestion[]> {
  if (!useWebSearch.getState().suggestions || !text.trim()) return Promise.resolve([]);
  return invoke<SearchSuggestion[]>("browser_search_suggest", { request: { text } }).catch(
    () => [],
  );
}
