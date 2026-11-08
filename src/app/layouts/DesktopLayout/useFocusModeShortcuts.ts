import { useCallback } from "react";
import { useFocusModeStore } from "@/app/shell";
import { useBrowserSearchStore } from "@/features/browser";
import { useShortcutHandler } from "@/features/shortcuts";
import { setBrowserWebviewsSuspended } from "@/features/app-windows";

/** Focus mode and tab search shortcuts; returns whether focus mode is on. */
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
  useShortcutHandler(
    "workspace.search_tabs",
    useCallback(() => {
      const search = useBrowserSearchStore.getState();
      if (search.open) search.close();
      else search.show();
    }, []),
  );
  return focusMode;
}
