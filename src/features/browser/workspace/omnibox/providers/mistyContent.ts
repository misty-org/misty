import { relevance } from "../relevance";
import type { OmniboxProvider } from "../types";
import type { OmniboxDeps } from "./deps";

const MIN_QUERY_LENGTH = 2;
const LIMIT = 3;

/**
 * Notes, Spaces and Library items on this device, so the address bar reaches
 * the rest of Misty. Searched locally; private tabs show none.
 */
export function mistyContentProvider(deps: OmniboxDeps): OmniboxProvider {
  return {
    id: "misty-content",
    start(input) {
      const query = input.text.trim().toLowerCase();
      if (query.length < MIN_QUERY_LENGTH || input.private) return [];
      return deps.mistyContent(query, LIMIT).map((item, index) => ({
        id: `content:${item.id}`,
        kind: "content" as const,
        title: item.title,
        detail: item.detail,
        target: { type: "open-in-app" as const, url: item.route },
        relevance:
          (item.title.toLowerCase().startsWith(query) ? relevance.contentTitlePrefix : relevance.content) -
          index,
        allowedToBeDefault: false,
      }));
    },
  };
}
