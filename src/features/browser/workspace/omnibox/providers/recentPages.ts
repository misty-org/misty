import { relevance } from "../relevance";
import type { OmniboxMatch, OmniboxProvider } from "../types";
import { describeUrl, urlKey } from "../urlText";
import type { OmniboxDeps } from "./deps";

const LIMIT = 8;
// Several visits to one page collapse into one row, so read more visits than rows.
const VISITS = 60;

/**
 * Suggestions before typing: the profile's recently visited pages, newest first, read
 * from local history only. None is the default, so nothing is highlighted until the
 * person picks one. Nothing is sent anywhere, and private tabs see none.
 */
export function recentPagesProvider(deps: OmniboxDeps): OmniboxProvider {
  return {
    id: "recent-pages",
    async start(input) {
      if (input.text.trim() || input.private) return [];
      const visits = await deps
        .recentVisits({ profileId: input.profileId, limit: VISITS })
        .catch(() => []);
      const seen = new Set([urlKey(input.currentUrl)]);
      const matches: OmniboxMatch[] = [];
      for (const visit of visits) {
        const key = urlKey(visit.url);
        const described = describeUrl(visit.url);
        if (!described || seen.has(key)) continue;
        seen.add(key);
        matches.push({
          id: `page:${key}`,
          kind: "history",
          title: visit.title || described.title,
          detail: described.detail,
          target: { type: "navigate", url: visit.url },
          relevance: relevance.topPage - matches.length,
          allowedToBeDefault: false,
          removable: true,
          faviconUrl: described.faviconUrl,
        });
        if (matches.length === LIMIT) break;
      }
      return matches;
    },
  };
}
