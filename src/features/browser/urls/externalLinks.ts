import { activeLayoutView } from "@/features/app-windows";
import type { WorkspaceView } from "@/features/app-windows";
import { openPeek } from "@/features/app-windows";
import { useWorkspaceStore } from "@/features/app-windows";

import { externalLinkMode } from "./externalLinkSettings";

/**
 * Opens a link another app handed to this window. Native code has already picked the window:
 * the profile that claims the site, else the one used last (`profile_windows/links.rs`).
 */
export function openExternalLink(url: string): WorkspaceView {
  if (externalLinkMode() === "peek") {
    const active = activeLayoutView(useWorkspaceStore.getState().layout);
    const peeked = active && !active.placeholder ? openPeek(url, active.id) : null;
    if (peeked) return peeked;
  }
  return useWorkspaceStore.getState().openBrowserView({ url });
}
