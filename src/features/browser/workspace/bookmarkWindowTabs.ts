import {
  addWebsite,
  createWebsiteGroup,
} from "@/features/browser-workspace/navigation";
import {
  allLayoutViews,
  isPrivateBrowserTab,
  parseBrowserTabState,
  useWorkspaceStore,
} from "@/features/workspace";

/**
 * Bookmark all tabs, like Chrome's: every web page open in this window goes
 * into a new saved-website group. Private tabs are left out.
 */
export function bookmarkWindowTabs(): { group: string; count: number } | null {
  const workspace = useWorkspaceStore.getState();
  const pages = new Map<string, string>();
  for (const view of allLayoutViews(workspace.layout)) {
    if (view.surfaceId !== "browser" || isPrivateBrowserTab(view)) continue;
    const url = parseBrowserTabState(view.state).url;
    if (/^https?:\/\//i.test(url) && !pages.has(url)) pages.set(url, view.title);
  }
  if (!pages.size) return null;
  const label = `Tabs ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  const groupId = createWebsiteGroup(label);
  for (const [url, title] of pages) addWebsite(groupId, title, url);
  return { group: label, count: pages.size };
}
