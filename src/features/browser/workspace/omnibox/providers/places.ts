import { relevance } from "../relevance";
import type { OmniboxMatch, OmniboxProvider } from "../types";
import type { OmniboxDeps } from "./deps";

const LIMIT = 6;

/** How well the typed text names a place: the whole name, a word's start, or not at all. */
function nameScore(query: string, name: string): number {
  const lower = name.toLowerCase();
  if (lower === query) return relevance.placeExact;
  if (lower.startsWith(query)) return relevance.placePrefix;
  if (lower.split(/[\s·/-]+/).some((word) => word.startsWith(query))) return relevance.placeWord;
  return 0;
}

/**
 * Misty's places, reached by name like any page: each Space and its sections
 * ("Launch team · Chat"), and your agents, whose page is their chats. A place
 * typed in full becomes the best guess; otherwise places rank below what was
 * typed.
 */
export function placesProvider(deps: OmniboxDeps): OmniboxProvider {
  return {
    id: "places",
    start(input) {
      const query = input.text.trim().toLowerCase();
      if (!query || input.private) return [];
      const matches: OmniboxMatch[] = [];
      for (const place of deps.places()) {
        const score = nameScore(query, place.title);
        if (!score) continue;
        matches.push({
          id: `place:${place.id}`,
          kind: "content",
          title: place.title,
          detail: place.detail,
          target: { type: "open-in-app", url: place.route },
          relevance: score,
          allowedToBeDefault: score === relevance.placeExact,
        });
      }
      return matches.sort((left, right) => right.relevance - left.relevance).slice(0, LIMIT);
    },
  };
}
