import { useEffect, useMemo } from "react";
import {
  createOmniboxProviders,
  liveOmniboxDeps,
  warmOmniboxCaches,
  useOmniboxAutocomplete,
  type OmniboxInput,
  type OmniboxMatch,
} from "@/features/browser/omnibox";
import { activeBrowserTabContext } from "@/features/workspace/browserTabs";
import type { SearchListItem } from "./SearchResultList";

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

/**
 * What the search box lists for its text: only search engine autosuggestions and
 * full websites. Internal Misty content, places, agents, and commands are excluded.
 */
export function useSearchItems(query: string, open: boolean) {
  const plain = open ? query : null;
  const plainInput = useMemo(() => (plain === null ? null : omniboxInput(plain)), [plain]);
  const matches = useOmniboxAutocomplete(plainInput, providers);
  useEffect(() => (open ? warmOmniboxCaches() : undefined), [open]);

  const items: SearchListItem[] = useMemo(
    () =>
      matches
        .filter(
          (match) =>
            match.target.type !== "open-in-app" &&
            match.kind !== "content" &&
            match.kind !== "action" &&
            !match.target.url?.startsWith("misty:"),
        )
        .map((match) => ({ type: "match" as const, match })),
    [matches],
  );

  return { items };
}
