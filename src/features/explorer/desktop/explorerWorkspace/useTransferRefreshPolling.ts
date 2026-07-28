import { useEffect, useRef } from "react";
import { useExplorerStore } from "@/stores/explorer";
import { transferRefreshPollMs } from "../ExplorerWorkspaceConstants";

/**
 * Re-lists directories that an in-flight transfer is writing into.
 *
 * Skipped while the window is hidden or a poll is already running, so a slow
 * listing cannot pile up behind itself.
 */
export function useTransferRefreshPolling(mountRoot: string) {
  const transferRefreshInFlightRef = useRef(false);

  useEffect(() => {
    const poll = async () => {
      if (
        document.hidden ||
        transferRefreshInFlightRef.current ||
        !useExplorerStore.getState().initialized
      )
        return;
      transferRefreshInFlightRef.current = true;
      try {
        await useExplorerStore.getState().pollTransferRefreshes(mountRoot);
      } finally {
        transferRefreshInFlightRef.current = false;
      }
    };
    const initialTimer = window.setTimeout(poll, 1000);
    const interval = window.setInterval(poll, transferRefreshPollMs);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
    };
  }, [mountRoot]);
}
