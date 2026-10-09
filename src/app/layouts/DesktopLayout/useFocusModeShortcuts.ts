import { useCallback } from "react";
import { useFocusModeStore } from "@/features/app-shell";
import { useBrowserSearchStore } from "@/features/browser-workspace/search";
import { useShortcutHandler } from "@/features/shortcuts";
import { setBrowserWebviewsSuspended } from "@/features/webviews/browserRuntime";

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
      if (search.open && search.scope === "tabs") search.close();
      else search.show("tabs");
    }, []),
  );
  return focusMode;
}
