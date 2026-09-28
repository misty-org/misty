import { relevance } from "../relevance";
import type { OmniboxProvider } from "../types";
import { directWebUrl } from "../urlText";
import { wait, type OmniboxDeps } from "./deps";

/** Waits for a pause in typing before asking the search engine. */
const DEBOUNCE_MS = 150;
const MAX_TEXT_LENGTH = 200;

/**
 * Searches suggested by the selected engine. Opt-in, and it only sends text
 * that is a search: never addresses, never from private tabs, never long
 * pastes. Any failure is silently no suggestions.
 */
export function searchSuggestProvider(deps: OmniboxDeps): OmniboxProvider {
  return {
    id: "search-suggest",
    async start(input, signal) {
      const text = input.text.trim();
      if (
        !text ||
        text.length > MAX_TEXT_LENGTH ||
        input.private ||
        !deps.searchSuggestionsEnabled() ||
        directWebUrl(text)
      )
        return [];
      await wait(DEBOUNCE_MS, signal);
      const engine = deps.searchEngine();
      const suggestions = await deps.fetchSearchSuggestions(engine.id, text).catch(() => []);
      return suggestions.map((suggestion, index) => ({
        id: `search:${suggestion.toLowerCase()}`,
        kind: "suggestion" as const,
        title: suggestion,
        detail: `Search with ${engine.name}`,
        target: { type: "navigate" as const, url: deps.searchUrl(suggestion) },
        relevance: relevance.suggestion - index,
        allowedToBeDefault: false,
      }));
    },
  };
}
