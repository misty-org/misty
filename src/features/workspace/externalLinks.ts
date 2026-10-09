import { profileForSite, profileIdFromScope } from "./browserProfiles";
import { activeLayoutView } from "./layoutTabs";
import type { WorkspaceView } from "./model";
import { openPeek } from "./peek";
import { useWorkspaceStore } from "./useWorkspaceStore";

import { externalLinkMode } from "./externalLinkSettings";

/**
 * Opens a link another app handed to Misty. A device profile that claims the
 * site opens it there; otherwise it stays in the profile on screen.
 */
export function openExternalLink(url: string): WorkspaceView {
  const store = useWorkspaceStore.getState();
  const profile = profileForSite(store.browserProfiles, url);
  if (profile && profileIdFromScope(store.activeScopeKey) !== profile.id)
    store.selectBrowserProfile(profile.id);
  if (externalLinkMode() === "peek") {
    const active = activeLayoutView(useWorkspaceStore.getState().layout);
    const peeked = active && !active.placeholder ? openPeek(url, active.id) : null;
    if (peeked) return peeked;
  }
  return useWorkspaceStore.getState().openBrowserView({ url });
}
