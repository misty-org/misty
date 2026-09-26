import { frecencyBonus, relevance } from "../relevance";
import type { OmniboxMatch, OmniboxProvider } from "../types";
import { describeUrl, urlKey } from "../urlText";
import type { OmniboxDeps } from "./deps";

const LIMIT = 6;

/**
 * Suggestions before typing: the profile's most-visited recent pages, read
 * from local history only. Nothing is sent anywhere, and private tabs see none.
 */
export function topPagesProvider(deps: OmniboxDeps): OmniboxProvider {
  return {
    id: "top-pages",
    async start(input) {
      if (input.text.trim() || input.private) return [];
      const pages = await deps
        .historySuggestions({ profileId: input.profileId, text: "", limit: LIMIT + 1 })
        .catch(() => []);
      return pages
        .filter((page) => urlKey(page.url) !== urlKey(input.currentUrl))
        .slice(0, LIMIT)
        .flatMap((page): OmniboxMatch[] => {
          const described = describeUrl(page.url);
          if (!described) return [];
          return [
            {
              id: `page:${urlKey(page.url)}`,
              kind: "history",
              title: page.title || described.title,
              detail: described.detail,
              target: { type: "navigate", url: page.url },
              relevance: relevance.topPage + frecencyBonus(page, 200),
              allowedToBeDefault: false,
              removable: true,
              faviconUrl: described.faviconUrl,
            },
          ];
        });
    },
  };
}
