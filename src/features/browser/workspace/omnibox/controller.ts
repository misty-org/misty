import type { OmniboxMatch } from "./types";
import { urlKey } from "./urlText";

const OMNIBOX_MAX_MATCHES = 8;

/** Matches for the same web page merge into one row; searches merge by text. */
function dedupeKey(match: OmniboxMatch): string {
  const isPage = match.kind !== "search" && match.kind !== "suggestion";
  return isPage ? `page:${urlKey(match.target.url)}` : match.id;
}

function viewIdOf(match: OmniboxMatch): string | undefined {
  return match.target.type === "switch-tab" ? match.target.tabId : match.switchViewId;
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
    // A typed address carries no favicon of its own; take one from a page already visited.
    faviconUrl: base.faviconUrl || other.faviconUrl || base.faviconUrl,
    switchViewId: page ? (viewIdOf(a) ?? viewIdOf(b)) : undefined,
  };
}

/**
 * Merges every provider's matches into the list the address bar shows: one
 * row per page or search, best first, with a match allowed to be the default
 * always on top so Enter never lands somewhere surprising.
 */
export function mergeMatches(
  groups: OmniboxMatch[][],
  limit = OMNIBOX_MAX_MATCHES,
): OmniboxMatch[] {
  const byKey = new Map<string, OmniboxMatch>();
  for (const match of groups.flat()) {
    const key = dedupeKey(match);
    const existing = byKey.get(key);
    byKey.set(key, existing ? merge(existing, match) : match);
  }
  const sorted = withKnownFavicons([...byKey.values()]).sort(
    (a, b) => b.relevance - a.relevance || a.title.localeCompare(b.title),
  );
  const defaultIndex = sorted.findIndex((match) => match.allowedToBeDefault);
  if (defaultIndex > 0) sorted.unshift(...sorted.splice(defaultIndex, 1));
  return sorted.slice(0, limit);
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Lends a site's favicon to its other rows that lack one, such as a typed address for a
 * site in history. Only origins some provider already knows lend; a draft that matches
 * nothing visited keeps the globe and never triggers a request to the typed host.
 */
function withKnownFavicons(matches: OmniboxMatch[]): OmniboxMatch[] {
  const known = new Map<string, string>();
  for (const match of matches) {
    const origin = match.faviconUrl ? originOf(match.target.url) : null;
    if (origin && !known.has(origin)) known.set(origin, match.faviconUrl!);
  }
  return matches.map((match) => {
    if (match.faviconUrl) return match;
    if (match.kind === "search") {
      // A typed word that names a known site ("leetcode") borrows that site's icon.
      const word = match.title.trim().toLowerCase();
      for (const [origin, faviconUrl] of known) {
        if (siteName(origin) === word) return { ...match, faviconUrl };
      }
      return match;
    }
    if (!["url", "history", "bookmark", "tab"].includes(match.kind)) return match;
    const origin = originOf(match.target.url);
    const faviconUrl = origin ? known.get(origin) : undefined;
    return faviconUrl ? { ...match, faviconUrl } : match;
  });
}

/** `https://www.leetcode.com` -> `leetcode`: the host's name without "www" and the suffix. */
function siteName(origin: string): string {
  try {
    const parts = new URL(origin).hostname.replace(/^www\./, "").split(".");
    return parts.length > 1 ? parts[parts.length - 2] : parts[0];
  } catch {
    return "";
  }
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
