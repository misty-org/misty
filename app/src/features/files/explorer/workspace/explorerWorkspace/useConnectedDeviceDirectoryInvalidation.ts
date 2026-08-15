import { hasTauriInternals } from "@/shared/platform/tauri";
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { useExplorerStore } from "../../store";

export function useConnectedDeviceDirectoryInvalidation(): void {
  useEffect(() => {
    if (!hasTauriInternals()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<string>("connected-device-directory-invalidated", (event) => {
      const state = useExplorerStore.getState();
      for (const [paneId, pane] of Object.entries(state.panes)) {
        if (pane.listing?.path === event.payload && !pane.loading) {
          void state.refreshPane(paneId);
        }
      }
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}
