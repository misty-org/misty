import engineTable from "@/shared/schemas/browser-search-engines.json";

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
  configuredEngine =
    browserSearchEngines.find((engine) => engine.id === id) ?? browserSearchEngines[0];
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

/** A search shortcut the person added, typed as `!trigger` in search. */
export interface BrowserCustomBang {
  trigger: string;
  name: string;
  /** `%s` is replaced with the URI-encoded query. */
  url: string;
}

export const customBangTriggerPattern = /^[a-z0-9][a-z0-9.-]{0,23}$/;

/** Why a custom shortcut is unusable, or null when it is fine. */
export function customBangProblem(bang: BrowserCustomBang): string | null {
  if (!customBangTriggerPattern.test(bang.trigger))
    return "Use up to 24 lowercase letters, digits, dots or dashes.";
  if (!bang.name.trim() || bang.name.length > 60) return "Use a name between 1 and 60 characters.";
  if (!bang.url.includes("%s")) return "Put %s in the address where the search goes.";
  try {
    const url = new URL(bang.url.replace("%s", "query"));
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
  } catch {
    return "Use an http or https address.";
  }
  return null;
}

/** Synced settings are untrusted: anything malformed is dropped, not repaired. */
export function parseBrowserCustomBangs(raw: string): BrowserCustomBang[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const { trigger, name, url } = item as Record<string, unknown>;
    if (typeof trigger !== "string" || typeof name !== "string" || typeof url !== "string")
      return [];
    const bang = { trigger: trigger.toLowerCase(), name: name.trim(), url };
    if (customBangProblem(bang) || seen.has(bang.trigger)) return [];
    seen.add(bang.trigger);
    return [bang];
  });
}

let customBangs: BrowserCustomBang[] = [];

export function browserCustomBangs(): readonly BrowserCustomBang[] {
  return customBangs;
}

export function configureBrowserCustomBangs(raw: string): void {
  customBangs = parseBrowserCustomBangs(raw);
}
