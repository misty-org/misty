import { setAppZoom } from "@/shared/hooks/useAppZoom";
import { applyAppTheme } from "../store/appTheme";
import {
  applyNightLight,
  msUntilNextNightLightSwitch,
  nightLightActive,
  nightLightTint,
} from "../store/nightLight";
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
    applyAppTheme(appearance.themeMode);
    if (appearance.themeMode !== "system") return;
    const query = window.matchMedia?.("(prefers-color-scheme: light)");
    const follow = () => applyAppTheme("system");
    query?.addEventListener("change", follow);
    return () => query?.removeEventListener("change", follow);
  }, [appearance.themeMode]);

  const { nightLightMode, nightLightStart, nightLightEnd, nightLightWarmth } = appearance;
  useEffect(() => {
    const schedule = { startAt: nightLightStart, endAt: nightLightEnd };
    const apply = () =>
      applyNightLight(
        nightLightActive(nightLightMode, schedule) ? nightLightTint(nightLightWarmth) : null,
      );
    apply();
    if (nightLightMode !== "scheduled") return;
    // Re-check at each switch time; one timer at a time, re-armed after each.
    // Timers stall while the Mac sleeps, so waking up checks again too.
    let timer = 0;
    const arm = () => {
      timer = window.setTimeout(() => {
        apply();
        arm();
      }, msUntilNextNightLightSwitch(schedule));
    };
    arm();
    window.addEventListener("focus", apply);
    document.addEventListener("visibilitychange", apply);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", apply);
      document.removeEventListener("visibilitychange", apply);
    };
  }, [nightLightMode, nightLightStart, nightLightEnd, nightLightWarmth]);

  useEffect(() => {
    setAppZoom(appearance.appZoom);
  }, [appearance.appZoom]);
}
