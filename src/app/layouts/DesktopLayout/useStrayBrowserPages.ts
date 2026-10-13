import { useEffect } from "react";
import {
  closeOrphanBrowserPages,
  scheduleStrayPageSweep,
} from "@/features/webviews/browserRuntime";
import { useWorkspaceStore } from "@/features/workspace";
import { allLayoutViews } from "@/features/workspace/layoutTabs";
import { hasTauriInternals } from "@/shared/platform/tauri";

/** Long enough for the window's Space and its recovered tabs to settle after a load. */
const orphanCloseDelayMs = 8_000;

/**
 * Cleans up pages left from before this renderer loaded. Native pages outlive a reload so tabs
 * can take theirs back, but until a tab does, a page still sits where it was, over whatever
 * the window shows now. So every tab page is hidden at once, and once the tabs have settled,
 * pages that belong to none of the window's tabs (in any Space it holds) are closed.
 */
export function useStrayBrowserPages() {
  useEffect(() => {
    if (!hasTauriInternals()) return;
    scheduleStrayPageSweep();
    const timer = window.setTimeout(() => {
      void closeOrphanBrowserPages(() => {
        const state = useWorkspaceStore.getState();
        const layouts = new Set([state.layout, ...Object.values(state.layoutsByScope)]);
        return [...layouts].flatMap((layout) => (layout ? allLayoutViews(layout) : []));
      });
    }, orphanCloseDelayMs);
    return () => window.clearTimeout(timer);
  }, []);
}
