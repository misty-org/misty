import { setAppZoom } from "@/shared/hooks/useAppZoom";
import { applyAppTheme, msUntilNextThemeSwitch } from "../store/appTheme";
import { selectAppearancePreferences } from "../store/preferences";
import { useSettingsStore } from "../store/useSettingsStore";
import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";

export function useDocumentAppAppearance() {
  const appearance = useSettingsStore(
    useShallow((state) => selectAppearancePreferences(state.settings?.document)),
  );

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.compactMode = String(appearance.compactModeEnabled);
  }, [appearance]);

  useEffect(() => {
    const schedule = { lightAt: appearance.themeLightAt, darkAt: appearance.themeDarkAt };
    applyAppTheme(appearance.themeMode, schedule);
    if (appearance.themeMode === "scheduled") {
      // Re-apply at each switch time; one timer at a time, re-armed after each.
      let timer = 0;
      const arm = () => {
        timer = window.setTimeout(() => {
          applyAppTheme("scheduled", schedule);
          arm();
        }, msUntilNextThemeSwitch(schedule));
      };
      arm();
      return () => window.clearTimeout(timer);
    }
    if (appearance.themeMode !== "system") return;
    const query = window.matchMedia?.("(prefers-color-scheme: light)");
    const follow = () => applyAppTheme("system");
    query?.addEventListener("change", follow);
    return () => query?.removeEventListener("change", follow);
  }, [appearance.themeMode, appearance.themeLightAt, appearance.themeDarkAt]);

  useEffect(() => {
    setAppZoom(appearance.appZoom);
  }, [appearance.appZoom]);
}
