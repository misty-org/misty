import type { DesktopPlatform } from "@/app/layouts/model";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef } from "react";

// Windows opens Snap Layouts when the pointer rests on a maximize button.
// Misty's is drawn in the page, so it asks for the flyout itself.
export function useWindowsSnapLayouts(desktopPlatform: DesktopPlatform) {
  const snapLayoutsTimerRef = useRef<number | undefined>(undefined);
  const cancelSnapLayouts = useCallback(() => {
    window.clearTimeout(snapLayoutsTimerRef.current);
    snapLayoutsTimerRef.current = undefined;
  }, []);
  const showSnapLayoutsSoon = useCallback(() => {
    if (!hasTauriInternals() || desktopPlatform !== "windows") return;
    cancelSnapLayouts();
    snapLayoutsTimerRef.current = window.setTimeout(() => {
      snapLayoutsTimerRef.current = undefined;
      void invoke("window_show_snap_layouts").catch(() => undefined);
    }, 500);
  }, [cancelSnapLayouts, desktopPlatform]);
  useEffect(() => cancelSnapLayouts, [cancelSnapLayouts]);
  return { showSnapLayoutsSoon, cancelSnapLayouts };
}
