import engineTable from "@/shared/contracts/browser-search-engines.json";

/**
 * The search engine a typed query falls back to in the browser surface.
 *
 * Read through a function rather than a constant, the same way `browserHome`
 * works: the settings store pushes the saved preference in on load and on
 * every change, so the value stays live without threading props.
 *
 * The engine table is shared with the native host, which fetches search
 * suggestions from the `suggest` endpoints, so a changed endpoint is a data
 * fix in one file.
 */
export interface BrowserSearchEngine {
  id: string;
  name: string;
  /** `%s` is replaced with the URI-encoded query. */
  search: string;
  /** OpenSearch suggestions endpoint; `%s` is replaced with the query. */
  suggest?: string;
}

export const browserSearchEngines: readonly BrowserSearchEngine[] = engineTable;

let configuredEngine = browserSearchEngines[0];

export function browserSearchEngine(): BrowserSearchEngine {
  return configuredEngine;
}

/** Selects an engine by its stable id; unknown ids fall back to the first engine. */
export function configureBrowserSearchEngine(id: string): void {
  configuredEngine = browserSearchEngines.find((engine) => engine.id === id) ?? browserSearchEngines[0];
}

let suggestionsEnabled = false;

/** Whether typed text may be sent to the search engine for suggestions. Off by default. */
export function browserSearchSuggestionsEnabled(): boolean {
  return suggestionsEnabled;
}

export function configureBrowserSearchSuggestions(enabled: boolean): void {
  suggestionsEnabled = enabled;
}

export function browserSearchUrl(query: string): string {
  return configuredEngine.search.replace("%s", encodeURIComponent(query));
}
