import { activeLayoutView } from "./layoutTabs";
import type { WorkspaceView } from "./model";
import { openPeek } from "./peek";
import { useWorkspaceStore } from "./useWorkspaceStore";

import { externalLinkMode } from "./externalLinkSettings";

/**
 * Opens a link another app handed to this Space window. Native code has already
 * picked the window: the Space whose "Open these sites in this Space" claims the
 * site, else the one used last (`space_windows/links.rs`).
 */
export function openExternalLink(url: string): WorkspaceView {
  if (externalLinkMode() === "peek") {
    const active = activeLayoutView(useWorkspaceStore.getState().layout);
    const peeked = active && !active.placeholder ? openPeek(url, active.id) : null;
    if (peeked) return peeked;
  }
  return useWorkspaceStore.getState().openBrowserView({ url });
}
