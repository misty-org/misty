import { dockLeaves, useWorkspaceStore } from "@/features/workspace";

/** Asks the browser view `viewId` to load `url`, through its own navigation
 * (history, loading state, internal pages). */
export const browserNavigateEvent = "misty:browser-navigate";
export interface BrowserNavigateDetail {
  viewId: string;
  url: string;
}

/**
 * Opens a link from workspace chrome such as the bookmarks bar: in the focused
 * pane's browser tab, or a new tab when asked or when that pane shows
 * something else.
 */
export function openFromChrome(url: string, options: { newTab?: boolean } = {}) {
  const workspace = useWorkspaceStore.getState();
  const panes = dockLeaves(workspace.layout.root);
  const pane = panes.find((p) => p.id === workspace.layout.focusedPaneId) ?? panes[0];
  const view = pane?.views.find((v) => v.id === pane.activeViewId);
  if (!options.newTab && view?.surfaceId === "browser") {
    window.dispatchEvent(
      new CustomEvent<BrowserNavigateDetail>(browserNavigateEvent, {
        detail: { viewId: view.id, url },
      }),
    );
    return;
  }
  workspace.openBrowserView({ url, paneId: pane?.id, sourceViewId: view?.id });
}
