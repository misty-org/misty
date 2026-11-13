import { useEffect } from "react";
import {
  closeOrphanAgentPages,
  closeOrphanBrowserPages,
  scheduleStrayPageSweep,
} from "@/features/browser";
import { hasTauriInternals } from "@/shared/platform/tauri";

/** Long enough for the window to settle after a load. */
const orphanCloseDelayMs = 8_000;

/**
 * Cleans up pages left from before this renderer loaded. Native pages outlive a reload, but a
 * page left over still sits where it was, over whatever the window shows now. So every page is
 * hidden at once, and once the window has settled, tab pages nothing keeps live are closed.
 * Agents' pages from before the load belong to nothing here at all, so they close at once.
 */
export function useStrayBrowserPages() {
  useEffect(() => {
    if (!hasTauriInternals()) return;
    scheduleStrayPageSweep();
    void closeOrphanAgentPages();
    const timer = window.setTimeout(() => {
      void closeOrphanBrowserPages();
    }, orphanCloseDelayMs);
    return () => window.clearTimeout(timer);
  }, []);
}
