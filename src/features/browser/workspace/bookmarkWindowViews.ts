import { createBookmarkFolder, saveBookmark } from "@/features/bookmarks/library";
import {
  allLayoutViews,
  parseBrowserViewState,
  useWorkspaceStore,
} from "@/features/workspace";
import { isIncognitoWindow } from "@/features/workspace/spaceWindow";

/**
 * Bookmark all tabs, like Chrome's: every web page open in this window goes
 * into a new bookmark folder. Private tabs are left out.
 */
export function bookmarkWindowViews(): { group: string; count: number } | null {
  const workspace = useWorkspaceStore.getState();
  const pages = new Map<string, string>();
  for (const view of allLayoutViews(workspace.layout)) {
    if (view.surfaceId !== "browser" || isIncognitoWindow()) continue;
    const url = parseBrowserViewState(view.state).url;
    if (/^https?:\/\//i.test(url) && !pages.has(url)) pages.set(url, view.title);
  }
  if (!pages.size) return null;
  const label = `Tabs ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  const groupId = createBookmarkFolder(label);
  for (const [url, title] of pages) saveBookmark({ folderId: groupId, title, url });
  return { group: label, count: pages.size };
}
