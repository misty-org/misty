import { useEffect } from "react";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { startRestoreAfterReload } from "./afterReload";
import { startPageStateCapture } from "./capture";
import { hydrateViewHistories, startViewHistorySync } from "./history";

/** Saves page state and tab histories for this window's tabs, brings back histories saved
 * earlier, and restores a tab after WebKit reloads its page. */
export function PageStateBridge({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!hasTauriInternals() || !enabled) return;
    let active = true;
    const stopCapture = startPageStateCapture();
    const stopHistory = startViewHistorySync();
    const stopReloadRestore = startRestoreAfterReload();
    void hydrateViewHistories(() => active);
    return () => {
      active = false;
      stopCapture();
      stopHistory();
      stopReloadRestore();
    };
  }, [enabled]);
  return null;
}
