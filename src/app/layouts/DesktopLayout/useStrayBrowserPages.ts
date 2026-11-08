import { useEffect } from "react";
import { closeOrphanBrowserPages, scheduleStrayPageSweep } from "@/features/browser";
import { useWorkspaceStore } from "@/features/app-windows";
import { allLayoutViews } from "@/features/app-windows";
import { hasTauriInternals } from "@/shared/platform/tauri";

/** Long enough for the window's recovered tabs to settle after a load. */
const orphanCloseDelayMs = 8_000;

/**
 * Cleans up pages left from before this renderer loaded. Native pages outlive a reload so tabs
 * can take theirs back, but until a tab does, a page still sits where it was, over whatever
 * the window shows now. So every tab page is hidden at once, and once the tabs have settled,
 * pages that belong to none of the window's tabs are closed.
 */
export function useStrayBrowserPages() {
  useEffect(() => {
    if (!hasTauriInternals()) return;
    scheduleStrayPageSweep();
    const timer = window.setTimeout(() => {
      void closeOrphanBrowserPages(() => {
        return allLayoutViews(useWorkspaceStore.getState().layout);
      });
    }, orphanCloseDelayMs);
    return () => window.clearTimeout(timer);
  }, []);
}
