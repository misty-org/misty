import { relevance } from "../relevance";
import type { OmniboxMatch, OmniboxProvider } from "../types";
import { describeUrl, directWebUrl } from "../urlText";
import type { OmniboxDeps } from "./deps";

/**
 * What the person typed, taken literally: the address it names, and a search
 * for the text. One of these is always allowed to be the default match.
 */
export function typedProvider(deps: OmniboxDeps): OmniboxProvider {
  return {
    id: "typed",
    start(input) {
      const text = input.text.trim();
      // Before typing, the recent pages are the list; the current page is not repeated.
      if (!text) return [];
      const matches: OmniboxMatch[] = [];
      const address = directWebUrl(text);
      const described = address ? describeUrl(address) : null;
      if (address && described) {
        matches.push({
          id: `url:${address}`,
          kind: "url",
          title: described.title,
          detail: described.detail,
          target: { type: "navigate", url: address },
          relevance: relevance.typedUrl,
          allowedToBeDefault: true,
          // Never turn an address-bar draft into a network request.
          faviconUrl: null,
        });
      }
      matches.push({
        id: `search:${text.toLowerCase()}`,
        kind: "search",
        title: text,
        // The search icon says what the row does; no "Search with" label.
        detail: "",
        target: { type: "navigate", url: deps.searchUrl(text) },
        relevance: address ? relevance.typedSearchForAddress : relevance.typedSearch,
        allowedToBeDefault: true,
      });
      return matches;
    },
  };
}
