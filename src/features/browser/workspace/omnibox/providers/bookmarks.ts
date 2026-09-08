import { baseRelevance, matchQuality, relevance } from "../relevance";
import type { OmniboxMatch, OmniboxProvider } from "../types";
import { describeUrl, inlineCompletion, strippedUrl, urlKey } from "../urlText";
import type { OmniboxDeps } from "./deps";

const LIMIT = 4;

interface PreparedBookmark {
  url: string;
  title: string;
  key: string;
  stripped: string;
  described: NonNullable<ReturnType<typeof describeUrl>>;
}

/**
 * Parsed addresses for one bookmark list. An imported library can hold
 * thousands of bookmarks; parsing each URL on every keystroke stalled typing,
 * so each list is prepared once and reused until the bookmarks change.
 */
const prepared = new WeakMap<object, PreparedBookmark[]>();

export function prepareBookmarks(list: { url: string; title: string }[]): PreparedBookmark[] {
  const cached = prepared.get(list);
  if (cached) return cached;
  const next = list.flatMap(({ url, title }) => {
    const described = describeUrl(url);
    if (!described) return [];
    const stripped = strippedUrl(url).toLowerCase();
    return [{ url, title, key: stripped.replace(/\/$/, ""), stripped, described }];
  });
  prepared.set(list, next);
  return next;
}

/**
 * Saved websites. A bookmark is a strong signal, so one whose address starts
 * with the typed text completes inline, like a page typed before.
 */
export function bookmarksProvider(deps: OmniboxDeps): OmniboxProvider {
  return {
    id: "bookmarks",
    start(input) {
      if (!input.text.trim()) return [];
      const current = urlKey(input.currentUrl);
      const matches: OmniboxMatch[] = [];
      for (const bookmark of prepareBookmarks(deps.bookmarks())) {
        if (bookmark.key === current) continue;
        const quality = matchQuality(input.text, bookmark.url, bookmark.title, bookmark.stripped);
        if (quality === "none") continue;
        const completion =
          quality === "address-prefix" ? inlineCompletion(input.text, bookmark.url) : undefined;
        matches.push({
          id: `page:${bookmark.key}`,
          kind: "bookmark",
          title: bookmark.title || bookmark.described.title,
          detail: bookmark.described.detail,
          target: { type: "navigate", url: bookmark.url },
          relevance:
            completion !== undefined ? relevance.bookmarkPrefix : baseRelevance(quality) + 50,
          allowedToBeDefault: completion !== undefined,
          inlineCompletion: completion,
          faviconUrl: bookmark.described.faviconUrl,
        });
      }
      return matches.sort((a, b) => b.relevance - a.relevance).slice(0, LIMIT);
    },
  };
}
