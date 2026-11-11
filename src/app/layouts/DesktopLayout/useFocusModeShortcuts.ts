import { useCallback } from "react";
import { useFocusModeStore } from "@/app/shell";
import { useShortcutHandler } from "@/features/shortcuts";
import { setBrowserWebviewsSuspended } from "@/features/app-windows";

/** The focus mode shortcut; returns whether focus mode is on. */
export function useFocusModeShortcuts() {
  const focusMode = useFocusModeStore((state) => state.active);
  useShortcutHandler(
    "app.toggle_focus_mode",
    useCallback(() => {
      // Native pages hide while the chrome animates so they never lag behind it.
      setBrowserWebviewsSuspended(true, "focus-mode");
      useFocusModeStore.getState().toggle();
      window.setTimeout(() => setBrowserWebviewsSuspended(false, "focus-mode"), 320);
    }, []),
  );
  return focusMode;
}
