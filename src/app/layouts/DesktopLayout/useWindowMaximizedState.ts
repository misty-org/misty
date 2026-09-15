import { hasTauriInternals } from "@/shared/platform/tauri";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";

export function useWindowMaximizedState() {
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  useEffect(() => {
    if (!hasTauriInternals()) return;
    let disposed = false;
    let unlistenResize: (() => void) | undefined;
    let resizeStatusTimer: ReturnType<typeof setTimeout> | undefined;
    const window = getCurrentWindow();
    const syncMaximizedState = async () => {
      const maximized = await window.isMaximized();
      if (!disposed) setIsWindowMaximized(maximized);
    };
    void syncMaximizedState().catch(() => undefined);
    void window
      .onResized(() => {
        // Only titlebar status needs this query. Keep native IPC round trips
        // out of the live-resize hot path; AppKit sizes and paints immediately.
        if (disposed) return;
        clearTimeout(resizeStatusTimer);
        resizeStatusTimer = setTimeout(() => {
          void syncMaximizedState().catch(() => undefined);
        }, 120);
      })
      .then((unlisten) => {
        if (disposed) unlisten();
        else unlistenResize = unlisten;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      clearTimeout(resizeStatusTimer);
      unlistenResize?.();
    };
  }, []);
  return [isWindowMaximized, setIsWindowMaximized] as const;
}
