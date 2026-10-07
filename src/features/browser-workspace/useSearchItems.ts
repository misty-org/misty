import { useMemo } from "react";
import {
  createOmniboxProviders,
  liveOmniboxDeps,
  searchSuggestProvider,
  useOmniboxAutocomplete,
  type OmniboxInput,
  type OmniboxMatch,
} from "@/features/browser/omnibox";
import { allBangs } from "./bangs/catalog";
import { bangDestination, matchingBangs, parseBang } from "./bangs/parse";
import type { Bang, WebBang } from "./bangs/types";
import type { SearchListItem } from "./SearchResultList";
import { useScopedSearch } from "./useScopedSearch";

// Providers read their sources at query time, so one set serves every search.
const providers = createOmniboxProviders(liveOmniboxDeps);
const suggestProviders = [searchSuggestProvider(liveOmniboxDeps)];

function omniboxInput(text: string): OmniboxInput {
  return { text, tabId: "", currentUrl: "", private: false, sessionHistory: [] };
}

/** One row that sends `query` to a website shortcut. */
function webSearchMatch(bang: WebBang, query: string): OmniboxMatch[] {
  const url = bangDestination(bang, query);
  if (!url) return [];
  return [
    {
      id: `bang:${bang.trigger}:${query}`,
      kind: "search",
      title: query,
      detail: `Search ${bang.label}`,
      target: { type: "navigate", url },
      relevance: 0,
      allowedToBeDefault: true,
    },
  ];
}

/**
 * What the search box lists for its text: shortcuts while `!name` is typed,
 * the address bar's matches with no shortcut, the chosen place's results with
 * one, and the site's search suggestions for a website shortcut.
 */
export function useSearchItems(bang: Bang | null, query: string, open: boolean) {
  const bangs = allBangs();
  const suggestions = bang ? [] : matchingBangs(query, bangs);
  // `cats !yt` previews where Enter goes; the leading form already became a chip.
  const trailing = bang || suggestions.length ? null : parseBang(query, bangs);
  const scope = bang?.kind === "scope" ? bang.scope : "default";
  const scoped = useScopedSearch(scope, query, open);

  const text = query.trim();
  const plain = open && !bang && !trailing && !suggestions.length && text ? query : null;
  const webText = open && bang?.kind === "web" && text ? query : null;
  const plainInput = useMemo(() => (plain === null ? null : omniboxInput(plain)), [plain]);
  const webInput = useMemo(() => (webText === null ? null : omniboxInput(webText)), [webText]);
  const matches = useOmniboxAutocomplete(plainInput, providers);
  const webSuggestions = useOmniboxAutocomplete(webInput, suggestProviders);

  let items: SearchListItem[];
  if (suggestions.length) items = suggestions.map((entry) => ({ type: "bang", bang: entry }));
  else if (trailing?.bang.kind === "web")
    items = webSearchMatch(trailing.bang, trailing.query).map((match) => ({
      type: "match",
      match,
    }));
  else if (trailing) items = [{ type: "bang", bang: trailing.bang, query: trailing.query }];
  else if (bang?.kind === "web")
    items = webSuggestions.flatMap((match) =>
      webSearchMatch(bang, match.title).map((row) => ({ type: "match" as const, match: row })),
    );
  else if (bang) items = scoped.results.map((result) => ({ type: "result", result }));
  else items = matches.map((match) => ({ type: "match", match }));

  return {
    items,
    bangs,
    loading: bang?.kind === "scope" && scoped.loading,
  };
}
