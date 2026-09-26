import { baseRelevance, matchQuality, relevance } from "../relevance";
import type { OmniboxMatch, OmniboxProvider } from "../types";
import { describeUrl, inlineCompletion, urlKey } from "../urlText";
import type { OmniboxDeps } from "./deps";

const LIMIT = 4;

/**
 * Saved websites. A bookmark is a strong signal, so one whose address starts
 * with the typed text completes inline, like a page typed before.
 */
export function bookmarksProvider(deps: OmniboxDeps): OmniboxProvider {
  return {
    id: "bookmarks",
    start(input) {
      if (!input.text.trim()) return [];
      const matches: OmniboxMatch[] = [];
      for (const bookmark of deps.bookmarks()) {
        const described = describeUrl(bookmark.url);
        if (!described || urlKey(bookmark.url) === urlKey(input.currentUrl)) continue;
        const quality = matchQuality(input.text, bookmark.url, bookmark.title);
        if (quality === "none") continue;
        const completion =
          quality === "address-prefix" ? inlineCompletion(input.text, bookmark.url) : undefined;
        matches.push({
          id: `page:${urlKey(bookmark.url)}`,
          kind: "bookmark",
          title: bookmark.title || described.title,
          detail: described.detail,
          target: { type: "navigate", url: bookmark.url },
          relevance: completion !== undefined ? relevance.bookmarkPrefix : baseRelevance(quality) + 50,
          allowedToBeDefault: completion !== undefined,
          inlineCompletion: completion,
          faviconUrl: described.faviconUrl,
        });
      }
      return matches.sort((a, b) => b.relevance - a.relevance).slice(0, LIMIT);
    },
  };
}
