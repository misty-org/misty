import type { OmniboxProvider } from "../types";
import { bookmarksProvider } from "./bookmarks";
import { copiedLinkProvider } from "./copiedLink";
import type { OmniboxDeps } from "./deps";
import { historyProvider, sessionHistoryProvider } from "./history";
import { mistyContentProvider } from "./mistyContent";
import { mistyPagesProvider } from "./misty";
import { openTabsProvider } from "./openTabs";
import { placesProvider } from "./places";
import { searchSuggestProvider } from "./searchSuggest";
import { recentPagesProvider } from "./recentPages";
import { typedProvider } from "./typed";

export type { OmniboxDeps } from "./deps";

/** Every source the address bar draws on. Order does not affect ranking. */
export function createOmniboxProviders(deps: OmniboxDeps): OmniboxProvider[] {
  return [
    typedProvider(deps),
    sessionHistoryProvider(),
    bookmarksProvider(deps),
    openTabsProvider(deps),
    mistyPagesProvider(),
    placesProvider(deps),
    mistyContentProvider(deps),
    historyProvider(deps),
    recentPagesProvider(deps),
    copiedLinkProvider(deps),
    searchSuggestProvider(deps),
  ];
}
