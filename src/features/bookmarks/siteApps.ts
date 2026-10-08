import { useMemo } from "react";
import { allLayoutViews } from "@/features/workspace/layoutTabs";
import { parseBrowserViewState } from "@/features/workspace/model";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { removeBookmark, saveBookmark, useBookmarkLibrary } from "./library";
import { appsId, type Bookmark } from "./tree";

/** Installed site apps, kept (encrypted) as bookmarks in the Apps folder. */
export function useSiteApps(): Bookmark[] {
  const tree = useBookmarkLibrary();
  return useMemo(
    () => tree.children(appsId).flatMap((node) => (node.kind === "bookmark" ? [node] : [])),
    [tree],
  );
}

export function installSiteApp(url: string, name: string): string {
  return saveBookmark({ url, title: name, folderId: appsId });
}

export function uninstallSiteApp(id: string): void {
  removeBookmark(id);
}

/**
 * Opens an app in this Space window, reusing its tab when it is already open.
 * Returns the app's view so the caller can show it.
 */
export function launchSiteApp(app: Bookmark) {
  const store = useWorkspaceStore.getState();
  const view = allLayoutViews(store.layout).find(
    (candidate) =>
      candidate.surfaceId === "browser" &&
      parseBrowserViewState(candidate.state).bookmarkId === app.id,
  );
  if (view) {
    store.focusView(view.id);
    return view;
  }
  return store.openBrowserView({ url: app.url, bookmarkId: app.id });
}
