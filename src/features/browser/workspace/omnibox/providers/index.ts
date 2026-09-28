import type { OmniboxProvider } from "../types";
import { bookmarksProvider } from "./bookmarks";
import { copiedLinkProvider } from "./copiedLink";
import type { OmniboxDeps } from "./deps";
import { historyProvider, sessionHistoryProvider } from "./history";
import { mistyContentProvider } from "./mistyContent";
import { mistyPagesProvider } from "./misty";
import { openTabsProvider } from "./openTabs";
import { searchSuggestProvider } from "./searchSuggest";
import { topPagesProvider } from "./topPages";
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
    mistyContentProvider(deps),
    historyProvider(deps),
    topPagesProvider(deps),
    copiedLinkProvider(deps),
    searchSuggestProvider(deps),
  ];
}
