import { dockLeaves, useWorkspaceStore } from "@/features/workspace";
import { browserPageTools, useBrowserMediaStore } from "@/features/browser/library";
import { browserRuntimeIdForTabId } from "./browserRuntime";

import { autoPictureInPictureEnabled, pictureInPictureSupported } from "./pictureInPictureSettings";

function visibleBrowserViews(): Set<string> {
  const { layout } = useWorkspaceStore.getState();
  const ids = new Set<string>();
  for (const pane of dockLeaves(layout.root)) {
    const view = pane.views.find((item) => item.id === pane.activeViewId) ?? pane.views[0];
    if (view?.surfaceId === "browser") ids.add(view.id);
  }
  return ids;
}

/**
 * Watches which browser pages are on screen. A page hidden while it plays sound
 * enters picture in picture; when it is shown again, the floating video returns.
 * Only videos this module moved are moved back.
 */
export function startAutoPictureInPicture(): () => void {
  if (!pictureInPictureSupported()) return () => {};
  let visible = visibleBrowserViews();
  const floating = new Set<string>();
  const run = (tabId: string, mode: "enter" | "exit") => {
    const runtimeId = browserRuntimeIdForTabId(tabId);
    if (runtimeId) void browserPageTools.pictureInPicture(runtimeId, mode).catch(() => {});
  };
  return useWorkspaceStore.subscribe((state, previous) => {
    if (state.layout === previous.layout) return;
    const next = visibleBrowserViews();
    for (const id of visible) {
      if (next.has(id) || !autoPictureInPictureEnabled()) continue;
      if (useBrowserMediaStore.getState().audible[id]) {
        floating.add(id);
        run(id, "enter");
      }
    }
    for (const id of next) {
      if (visible.has(id) || !floating.has(id)) continue;
      floating.delete(id);
      run(id, "exit");
    }
    visible = next;
  });
}
