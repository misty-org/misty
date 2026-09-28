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
      if (!text) return currentPage(input.currentUrl);
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
        detail: `Search with ${deps.searchEngine().name}`,
        target: { type: "navigate", url: deps.searchUrl(text) },
        relevance: address ? relevance.typedSearchForAddress : relevance.typedSearch,
        allowedToBeDefault: true,
      });
      return matches;
    },
  };
}

/** Before typing, the page itself is the default, so Enter reloads it. */
function currentPage(url: string): OmniboxMatch[] {
  const described = describeUrl(url);
  if (!described) return [];
  return [
    {
      id: `url:${url}`,
      kind: "url",
      title: described.title,
      detail: described.detail,
      target: { type: "navigate", url },
      relevance: relevance.typedUrl,
      allowedToBeDefault: true,
      faviconUrl: null,
    },
  ];
}
