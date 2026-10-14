import { useDeferredValue, useEffect, useMemo } from "react";
import {
  createOmniboxProviders,
  liveOmniboxDeps,
  warmOmniboxCaches,
  searchSuggestProvider,
  useOmniboxAutocomplete,
  type OmniboxInput,
  type OmniboxMatch,
} from "@/features/browser/omnibox";
import { activeBrowserTabContext } from "@/features/workspace/browserTabs";
import { allBangs } from "./bangs/catalog";
import { bangDestination, matchingBangs, parseBang } from "./bangs/parse";
import type { Bang, WebBang } from "./bangs/types";
import type { SearchListItem } from "./SearchResultList";
import { useScopedSearch } from "./useScopedSearch";
import { searchCommands, searchSiteApps } from "./commandResults";

// Providers read their sources at query time, so one set serves every search.
// Enter here always opens a new tab, so pages that are already open stay in the
// list as ordinary suggestions that open another copy, never as "Switch to tab".
const providers = createOmniboxProviders(liveOmniboxDeps).map((provider) =>
  provider.id === "open-tabs"
    ? {
        ...provider,
        start: (input: OmniboxInput, signal: AbortSignal) =>
          (provider.start(input, signal) as OmniboxMatch[]).map((match): OmniboxMatch => ({
            ...match,
            kind: "history",
            target: { type: "navigate", url: match.target.url },
            allowedToBeDefault: false,
          })),
      }
    : provider,
);
const suggestProviders = [searchSuggestProvider(liveOmniboxDeps)];

function omniboxInput(text: string): OmniboxInput {
  // The focused tab's profile, so history cleared there stays gone here.
  const tab = activeBrowserTabContext();
  return {
    text,
    tabId: tab?.tabId ?? "",
    profileId: tab?.profileId,
    currentUrl: "",
    private: tab?.private ?? false,
    sessionHistory: [],
  };
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
  const plain = open && !bang && !trailing && !suggestions.length ? query : null;
  const webText = open && bang?.kind === "web" && text ? query : null;
  const plainInput = useMemo(() => (plain === null ? null : omniboxInput(plain)), [plain]);
  const webInput = useMemo(() => (webText === null ? null : omniboxInput(webText)), [webText]);
  const matches = useOmniboxAutocomplete(plainInput, providers);
  // Commands and site apps follow the deferred text, so typing paints before they are searched.
  const deferredPlain = useDeferredValue(plain);
  const commandResults = useMemo(
    () =>
      deferredPlain === null
        ? []
        : [...searchSiteApps(deferredPlain), ...searchCommands(deferredPlain)],
    [deferredPlain],
  );
  useEffect(() => (open ? warmOmniboxCaches() : undefined), [open]);
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
  else
    items = [
      ...matches.map((match) => ({ type: "match" as const, match })),
      // Matching commands follow the pages, so Enter still opens the typed address.
      ...(plain === null ? [] : commandResults).map((result) => ({
        type: "result" as const,
        result,
      })),
    ];

  return {
    items,
    bangs,
    loading: bang?.kind === "scope" && scoped.loading,
  };
}
