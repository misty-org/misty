import {
  appZoomChangedEvent,
  appZoomToStoredScale,
  getAppliedAppZoom,
  setAppZoom,
} from "@/shared/hooks/use_app_zoom";
import { writeDevicePreference } from "../device-preferences/bridge";
import { applyAppTheme } from "../preferences/app_theme";
import {
  applyNightLight,
  msUntilNextNightLightSwitch,
  nightLightActive,
  nightLightTint,
} from "../preferences/night_light";
import { selectAppearancePreferences } from "../preferences/preferences";
import { useSettingsStore } from "../preferences/use_settings_store";
import { useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";

export function useDocumentAppAppearance() {
  const appearance = useSettingsStore(
    useShallow((state) => selectAppearancePreferences(state.settings?.document)),
  );

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.compactMode = String(appearance.compactModeEnabled);
    root.dataset.reduceMotion = String(appearance.reduceMotion);
  }, [appearance]);

  const settingsLoaded = useSettingsStore((state) => state.settings !== null);
  useEffect(() => {
    if (!settingsLoaded) return;
    applyAppTheme(appearance.themeMode);
    if (appearance.themeMode !== "system") return;
    const query = window.matchMedia?.("(prefers-color-scheme: light)");
    const follow = () => applyAppTheme("system");
    query?.addEventListener("change", follow);
    return () => query?.removeEventListener("change", follow);
  }, [settingsLoaded, appearance.themeMode]);

  const { nightLightMode, nightLightStart, nightLightEnd, nightLightWarmth } = appearance;
  useEffect(() => {
    const schedule = { startAt: nightLightStart, endAt: nightLightEnd };
    const apply = () =>
      applyNightLight(
        nightLightActive(nightLightMode, schedule) ? nightLightTint(nightLightWarmth) : null,
      );
    apply();
    if (nightLightMode !== "scheduled") return;
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

  const loaded = settingsLoaded;
  const savedZoom = useRef(appearance.appZoom);
  savedZoom.current = appearance.appZoom;
  const echoes = useRef<number[]>([]);
  useEffect(() => {
    if (!loaded) return;
    const echo = echoes.current.indexOf(appearance.appZoom);
    if (echo !== -1) {
      echoes.current = echoes.current.slice(echo + 1);
      return;
    }
    setAppZoom(appearance.appZoom);
  }, [loaded, appearance.appZoom]);
  useEffect(() => {
    if (!loaded) return;
    const save = () => {
      const zoom = getAppliedAppZoom();
      if (zoom === savedZoom.current) return;
      savedZoom.current = zoom;
      echoes.current = [...echoes.current.slice(-9), zoom];
      void writeDevicePreference("app.zoom", appZoomToStoredScale(zoom)).catch(() => undefined);
    };
    window.addEventListener(appZoomChangedEvent, save);
    return () => window.removeEventListener(appZoomChangedEvent, save);
  }, [loaded]);
}
