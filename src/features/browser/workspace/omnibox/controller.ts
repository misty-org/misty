import type { OmniboxMatch } from "./types";
import { urlKey } from "./urlText";

export const OMNIBOX_MAX_MATCHES = 8;

/** Matches for the same web page merge into one row; searches merge by text. */
function dedupeKey(match: OmniboxMatch): string {
  const isPage = match.kind !== "search" && match.kind !== "suggestion" && match.kind !== "content";
  return isPage ? `page:${urlKey(match.target.url)}` : match.id;
}

function tabIdOf(match: OmniboxMatch): string | undefined {
  return match.target.type === "switch-tab" ? match.target.tabId : match.switchTabId;
}

/**
 * Combines two matches for one page. The row keeps the best relevance and
 * every signal either had; an open tab becomes a "Switch to tab" button on
 * the page row rather than a second row.
 */
function merge(a: OmniboxMatch, b: OmniboxMatch): OmniboxMatch {
  const [winner, other] = a.relevance >= b.relevance ? [a, b] : [b, a];
  const page = [winner, other].find((match) => match.target.type === "navigate");
  const base = page ?? winner;
  const completing = [winner, other].find((match) => match.allowedToBeDefault);
  return {
    ...base,
    title: base.title || other.title,
    relevance: winner.relevance,
    allowedToBeDefault: Boolean(completing),
    inlineCompletion: completing?.inlineCompletion,
    removable: Boolean(a.removable || b.removable),
    bookmarked: [a, b].some((match) => match.bookmarked || match.kind === "bookmark"),
    switchTabId: page ? (tabIdOf(a) ?? tabIdOf(b)) : undefined,
  };
}

/**
 * Merges every provider's matches into the list the address bar shows: one
 * row per page or search, best first, with a match allowed to be the default
 * always on top so Enter never lands somewhere surprising.
 */
export function mergeMatches(groups: OmniboxMatch[][], limit = OMNIBOX_MAX_MATCHES): OmniboxMatch[] {
  const byKey = new Map<string, OmniboxMatch>();
  for (const match of groups.flat()) {
    const key = dedupeKey(match);
    const existing = byKey.get(key);
    byKey.set(key, existing ? merge(existing, match) : match);
  }
  const sorted = [...byKey.values()].sort(
    (a, b) => b.relevance - a.relevance || a.title.localeCompare(b.title),
  );
  const defaultIndex = sorted.findIndex((match) => match.allowedToBeDefault);
  if (defaultIndex > 0) sorted.unshift(...sorted.splice(defaultIndex, 1));
  return sorted.slice(0, limit);
}

/**
 * Whether an earlier result still fits the new text, so slower providers'
 * rows can stay on screen until their fresh results arrive.
 */
export function stillMatches(match: OmniboxMatch, text: string): boolean {
  const query = text.trim().toLowerCase();
  if (!query) return false;
  return `${match.title} ${match.detail}`.toLowerCase().includes(query);
}
