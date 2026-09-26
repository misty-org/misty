import {
  baseRelevance,
  frecencyBonus,
  inlineWorthy,
  matchQuality,
  relevance,
} from "../relevance";
import type { OmniboxInput, OmniboxMatch, OmniboxProvider } from "../types";
import { describeUrl, inlineCompletion, urlKey } from "../urlText";
import { wait, type OmniboxDeps } from "./deps";

const DEBOUNCE_MS = 60;
const LIMIT = 8;

interface PageStats {
  url: string;
  title: string;
  visits: number;
  typedVisits: number;
  lastVisitedAt: number;
}

function historyMatch(input: OmniboxInput, page: PageStats, removable: boolean): OmniboxMatch | null {
  const described = describeUrl(page.url);
  if (!described || urlKey(page.url) === urlKey(input.currentUrl)) return null;
  const quality = matchQuality(input.text, page.url, page.title);
  if (quality === "none") return null;
  const completion = quality === "address-prefix" ? inlineCompletion(input.text, page.url) : undefined;
  const inline = completion !== undefined && inlineWorthy(page);
  const score = inline
    ? relevance.inlineAddress + frecencyBonus(page, 100)
    : baseRelevance(quality) + frecencyBonus(page, quality === "address-prefix" ? 200 : 100);
  return {
    id: `page:${urlKey(page.url)}`,
    kind: "history",
    title: page.title || described.title,
    detail: described.detail,
    target: { type: "navigate", url: page.url },
    relevance: score,
    allowedToBeDefault: inline,
    inlineCompletion: inline ? completion : undefined,
    removable,
    faviconUrl: described.faviconUrl,
  };
}

/** Before typing, the tab's own recent pages, newest first. */
function recentSessionPages(input: OmniboxInput): OmniboxMatch[] {
  const seen = new Set([urlKey(input.currentUrl)]);
  const matches: OmniboxMatch[] = [];
  for (const url of [...input.sessionHistory].reverse()) {
    const described = describeUrl(url);
    const key = urlKey(url);
    if (!described || seen.has(key)) continue;
    seen.add(key);
    matches.push({
      id: `page:${key}`,
      kind: "history",
      title: described.title,
      detail: described.detail,
      target: { type: "navigate", url },
      relevance: relevance.topPage - 50 - matches.length,
      allowedToBeDefault: false,
      faviconUrl: described.faviconUrl,
    });
  }
  return matches.slice(0, 3);
}

/** Pages from this tab's own back/forward list, which exist even in private tabs. */
export function sessionHistoryProvider(): OmniboxProvider {
  return {
    id: "session-history",
    start(input) {
      if (!input.text.trim()) return recentSessionPages(input);
      const now = Date.now();
      return input.sessionHistory
        .map((url, index, entries) =>
          historyMatch(
            input,
            // Later entries are more recent; one visit each, none known to be typed.
            { url, title: "", visits: 1, typedVisits: 0, lastVisitedAt: now - (entries.length - index) * 60_000 },
            false,
          ),
        )
        .filter((match): match is OmniboxMatch => match !== null);
    },
  };
}

/** The profile's durable browsing history, ranked by frecency. */
export function historyProvider(deps: OmniboxDeps): OmniboxProvider {
  return {
    id: "history",
    async start(input, signal) {
      const text = input.text.trim();
      if (!text || input.private) return [];
      await wait(DEBOUNCE_MS, signal);
      const pages = await deps
        .historySuggestions({ profileId: input.profileId, text, limit: LIMIT })
        .catch(() => []);
      return pages
        .map((page) => historyMatch(input, page, true))
        .filter((match): match is OmniboxMatch => match !== null);
    },
  };
}
