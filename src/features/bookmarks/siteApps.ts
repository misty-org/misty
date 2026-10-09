import { useMemo } from "react";
import { allLayoutViews } from "@/features/workspace/layoutTabs";
import { parseBrowserViewState } from "@/features/workspace/model";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { currentWindows } from "@/features/workspace/windows";
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

/** The virtual window an app's page lives in, if one is open in this profile. */
function appWindowId(appId: string): string | null {
  return (
    currentWindows(useWorkspaceStore.getState()).find((window) =>
      allLayoutViews(window.layout).some(
        (view) =>
          view.surfaceId === "browser" && parseBrowserViewState(view.state).bookmarkId === appId,
      ),
    )?.id ?? null
  );
}

/**
 * Opens an app in its own virtual window, named after it, reusing that window
 * when it is already open. Returns the app's view so the caller can show it.
 */
export function launchSiteApp(app: Bookmark) {
  const store = useWorkspaceStore.getState();
  const existing = appWindowId(app.id);
  if (existing) {
    store.switchWindow(existing);
    const view = allLayoutViews(useWorkspaceStore.getState().layout).find(
      (candidate) => parseBrowserViewState(candidate.state).bookmarkId === app.id,
    );
    if (view) useWorkspaceStore.getState().focusView(view.id);
    return view ?? null;
  }
  store.createWindow(app.title);
  const fresh = useWorkspaceStore.getState();
  // Fill the new window's empty pane rather than adding a second tab beside it.
  return fresh.openBrowserView({
    url: app.url,
    bookmarkId: app.id,
    paneId: fresh.layout.focusedPaneId,
  });
}
