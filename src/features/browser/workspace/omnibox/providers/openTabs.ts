import { baseRelevance, matchQuality, relevance } from "../relevance";
import type { OmniboxMatch, OmniboxProvider } from "../types";
import { describeUrl, urlKey } from "../urlText";
import type { OmniboxDeps } from "./deps";

const LIMIT = 3;

/**
 * Pages already open in another tab, offered as "Switch to tab" so the person
 * does not open a duplicate. Only tabs in the same profile and privacy mode
 * are visible, and never tabs an agent opened for its own work.
 */
export function openTabsProvider(deps: OmniboxDeps): OmniboxProvider {
  return {
    id: "open-tabs",
    start(input) {
      if (!input.text.trim()) return [];
      const matches: OmniboxMatch[] = [];
      for (const tab of deps.openTabs()) {
        if (
          tab.tabId === input.tabId ||
          tab.agentOwned ||
          tab.private !== input.private ||
          (tab.profileId ?? "") !== (input.profileId ?? "")
        )
          continue;
        const described = describeUrl(tab.url);
        if (!described) continue;
        const quality = matchQuality(input.text, tab.url, tab.title);
        if (quality === "none") continue;
        matches.push({
          id: `tab:${tab.tabId}`,
          kind: "tab",
          title: tab.title || described.title,
          detail: described.detail,
          target: { type: "switch-tab", tabId: tab.tabId, url: tab.url },
          relevance:
            quality === "address-prefix" ? relevance.openTabPrefix : baseRelevance(quality) - 50,
          allowedToBeDefault: false,
          faviconUrl: described.faviconUrl,
        });
      }
      // One row per page, even when it is open in several tabs.
      const seen = new Set<string>();
      return matches
        .sort((a, b) => b.relevance - a.relevance)
        .filter((match) => {
          const key = urlKey(match.target.url);
          return !seen.has(key) && seen.add(key);
        })
        .slice(0, LIMIT);
    },
  };
}
