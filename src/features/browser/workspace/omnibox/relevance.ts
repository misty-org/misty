import { strippedUrl, typedUrlText } from "./urlText";

/**
 * Relevance scores, on a scale like Chrome's. What-you-typed anchors the
 * scale; a page only outranks searching for the typed text when the person
 * visits it often, recently, and by typing its address.
 */
export const relevance = {
  typedUrl: 1200,
  typedSearch: 1300,
  /** Searching still ranks high when the text looks like an address. */
  typedSearchForAddress: 1150,
  /** A familiar page whose address starts with the typed text: completes inline, beating search. */
  inlineAddress: 1350,
  addressPrefix: 1050,
  bookmarkPrefix: 1340,
  titleWordPrefix: 850,
  substring: 650,
  openTabPrefix: 950,
  suggestion: 800,
  topPage: 600,
  action: 1000,
  contentTitlePrefix: 900,
  content: 620,
  copiedLink: 850,
} as const;

export type MatchQuality = "address-prefix" | "title-word-prefix" | "substring" | "none";

/** How well typed text matches a page, best first. */
export function matchQuality(text: string, url: string, title: string): MatchQuality {
  const typed = typedUrlText(text);
  if (!typed) return "none";
  if (strippedUrl(url).toLowerCase().startsWith(typed)) return "address-prefix";
  const query = text.trim().toLowerCase();
  const words = title.toLowerCase().split(/[\s\-–—|:·,/]+/);
  if (words.some((word) => word.startsWith(query)) || title.toLowerCase().startsWith(query))
    return "title-word-prefix";
  if (url.toLowerCase().includes(query) || title.toLowerCase().includes(query)) return "substring";
  return "none";
}

export function baseRelevance(quality: MatchQuality, prefix: number = relevance.addressPrefix): number {
  switch (quality) {
    case "address-prefix":
      return prefix;
    case "title-word-prefix":
      return relevance.titleWordPrefix;
    case "substring":
      return relevance.substring;
    default:
      return 0;
  }
}

const DAY_MS = 86_400_000;

/**
 * A bonus that grows with visits (typed visits count triple) and fades with
 * age, saturating at `cap` so no page runs away with the list.
 */
export function frecencyBonus(
  stats: { visits: number; typedVisits: number; lastVisitedAt: number },
  cap: number,
  now = Date.now(),
): number {
  const ageDays = Math.max(0, now - stats.lastVisitedAt) / DAY_MS;
  const score = (stats.visits + 2 * stats.typedVisits) / (1 + ageDays / 7);
  return Math.round((cap * score) / (score + 3));
}

/** Pages worth completing inline: typed before, or visited more than once. */
export function inlineWorthy(stats: { visits: number; typedVisits: number }): boolean {
  return stats.typedVisits > 0 || stats.visits >= 2;
}
