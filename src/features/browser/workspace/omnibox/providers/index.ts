import type { OmniboxProvider } from "../types";
import { bookmarksProvider } from "./bookmarks";
import { copiedLinkProvider } from "./copiedLink";
import type { OmniboxDeps } from "./deps";
import { historyProvider, sessionHistoryProvider } from "./history";
import { openTabsProvider } from "./openTabs";
import { searchSuggestProvider } from "./searchSuggest";
import { recentPagesProvider } from "./recentPages";
import { typedProvider } from "./typed";

export type { OmniboxDeps } from "./deps";

export function createOmniboxProviders(deps: OmniboxDeps): OmniboxProvider[] {
  return [
    typedProvider(deps),
    sessionHistoryProvider(),
    bookmarksProvider(deps),
    openTabsProvider(deps),
    historyProvider(deps),
    recentPagesProvider(deps),
    copiedLinkProvider(deps),
    searchSuggestProvider(deps),
  ];
}
