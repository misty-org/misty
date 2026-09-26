import { browserInternalPages } from "@/features/workspace/browserInternalUrl";
import { relevance } from "../relevance";
import type { OmniboxMatch, OmniboxProvider } from "../types";

const MIN_QUERY_LENGTH = 2;

/** Extra words that name each of Misty's own browser pages. */
const keywords: Record<keyof typeof browserInternalPages, string[]> = {
  history: ["history", "recent", "visited"],
  downloads: ["downloads", "files"],
  bookmarks: ["bookmarks", "saved", "favorites"],
  extensions: ["extensions", "add-ons"],
  settings: ["settings", "preferences", "search engine", "clear browsing data", "privacy"],
};

/** Misty's own pages, reached by name from the address bar (like chrome://history). */
export function mistyPagesProvider(): OmniboxProvider {
  return {
    id: "misty-pages",
    start(input) {
      const query = input.text.trim().toLowerCase();
      if (query.length < MIN_QUERY_LENGTH) return [];
      const matches: OmniboxMatch[] = [];
      for (const [page, info] of Object.entries(browserInternalPages)) {
        const words = keywords[page as keyof typeof browserInternalPages];
        const exact = words.some((word) => word === query);
        if (!exact && !words.some((word) => word.startsWith(query))) continue;
        matches.push({
          id: `misty:${page}`,
          kind: "action",
          title: info.title,
          detail: info.url,
          target: { type: "navigate", url: info.url },
          relevance: exact ? relevance.action : relevance.action - 150,
          allowedToBeDefault: false,
        });
      }
      return matches;
    },
  };
}
