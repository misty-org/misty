import { useSettingsStore } from "@/features/settings";
import { setBrowserWebviewsSuspended } from "@/features/webviews/browserRuntime";
import { useCallback, useRef } from "react";
import { useFocusModeShortcuts } from "./useFocusModeShortcuts";
import {
  publishNavigatorLayout,
  useNavigatorLayoutValue,
  type NavigatorLayout,
} from "./navigatorMode";

/** Navigator auto-hide state, including the focus-mode override and its toggle. */
export function useNavigatorAutoHide() {
  const navigatorLayout = useNavigatorLayoutValue();
  const focusMode = useFocusModeShortcuts();
  // Focus mode hides the rail like auto-hide without changing the saved preference.
  const navigatorAutoHide = navigatorLayout.autoHide || focusMode;
  const navigatorLayoutRef = useRef(navigatorLayout);
  navigatorLayoutRef.current = navigatorLayout;
  const applyNavigatorLayout = useCallback((next: NavigatorLayout) => {
    setBrowserWebviewsSuspended(true, "navigator-layout");
    publishNavigatorLayout(next);
    useSettingsStore.getState().updateSetting("appearance", "navigator_auto_hide", next.autoHide);
    window.setTimeout(() => setBrowserWebviewsSuspended(false, "navigator-layout"), 320);
  }, []);
  const toggleNavigatorAutoHide = useCallback(() => {
    const current = navigatorLayoutRef.current;
    applyNavigatorLayout({
      ...current,
      autoHide: !current.autoHide,
    });
  }, [applyNavigatorLayout]);
  return { focusMode, navigatorAutoHide, toggleNavigatorAutoHide };
}
