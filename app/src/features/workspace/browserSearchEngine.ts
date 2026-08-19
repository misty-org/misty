/**
 * The search engine a typed query falls back to in the browser surface.
 *
 * Read through a function rather than a constant, the same way `browserHome`
 * works: the settings store pushes the saved preference in on load and on
 * every change, so the value stays live without threading props.
 */
export interface BrowserSearchEngine {
  id: string;
  name: string;
  /** `%s` is replaced with the URI-encoded query. */
  template: string;
}

export const browserSearchEngines: readonly BrowserSearchEngine[] = [
  { id: "google", name: "Google", template: "https://www.google.com/search?q=%s" },
  { id: "duckduckgo", name: "DuckDuckGo", template: "https://duckduckgo.com/?q=%s" },
  { id: "bing", name: "Bing", template: "https://www.bing.com/search?q=%s" },
  { id: "brave", name: "Brave", template: "https://search.brave.com/search?q=%s" },
  { id: "startpage", name: "Startpage", template: "https://www.startpage.com/sp/search?query=%s" },
];

let configuredEngine = browserSearchEngines[0];

export function browserSearchEngine(): BrowserSearchEngine {
  return configuredEngine;
}

export function configureBrowserSearchEngine(index: number): void {
  configuredEngine = browserSearchEngines[index] ?? browserSearchEngines[0];
}

export function browserSearchUrl(query: string): string {
  return configuredEngine.template.replace("%s", encodeURIComponent(query));
}
