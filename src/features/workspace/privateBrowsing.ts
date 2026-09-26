import { blankBrowserUrl } from "./browserUrl";
import { parseBrowserTabState, type WorkspaceTab } from "./model";

export const privateTabTitle = "Private tab";

export function isPrivateBrowserTab(tab: Pick<WorkspaceTab, "surfaceId" | "state"> | null | undefined) {
  return Boolean(tab && tab.surfaceId === "browser" && parseBrowserTabState(tab.state).private);
}

/**
 * What a private tab looks like anywhere outside this running app: on disk,
 * in recovery snapshots and in Sync. The tab keeps its place, but not where it
 * was or what it showed.
 */
export function scrubPrivateTab(tab: WorkspaceTab): WorkspaceTab {
  if (!isPrivateBrowserTab(tab)) return tab;
  return {
    ...tab,
    title: privateTabTitle,
    state: { version: 1, url: blankBrowserUrl, faviconUrl: null, private: true },
  };
}
