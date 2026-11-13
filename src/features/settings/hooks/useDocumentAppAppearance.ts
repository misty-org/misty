import {
  appZoomChangedEvent,
  appZoomRenderScale,
  getAppliedAppZoom,
  setAppZoom,
} from "@/shared/hooks/useAppZoom";
import { writeDevicePreference } from "../device-preferences/bridge";
import { applyAppTheme } from "../preferences/appTheme";
import {
  applyNightLight,
  msUntilNextNightLightSwitch,
  nightLightActive,
  nightLightTint,
} from "../preferences/nightLight";
import { selectAppearancePreferences } from "../preferences/preferences";
import { useSettingsStore } from "../preferences/useSettingsStore";
import { useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";

export function useDocumentAppAppearance() {
  const appearance = useSettingsStore(
    useShallow((state) => selectAppearancePreferences(state.settings?.document)),
  );

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.compactMode = String(appearance.compactModeEnabled);
  }, [appearance]);

  // Until the saved settings arrive the document holds only defaults (dark): the theme painted
  // at launch from the last choice (`applyCachedAppTheme`) stays until then.
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

  // The saved zoom (`app.zoom`) is the one the app shows, once it has loaded: before then the
  // document holds only its default, and applying that reset the zoom saved last time.
  const loaded = settingsLoaded;
  const savedZoom = useRef(appearance.appZoom);
  savedZoom.current = appearance.appZoom;
  // Zooms this window saved, until the settings document echoes them back: an echo of an older
  // step (zooming several steps quickly) must not move the zoom back.
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
  // A zoom changed anywhere else (the zoom shortcuts, the bottom bar) is saved to the same
  // preference, so it survives a restart instead of living in the webview's storage alone.
  useEffect(() => {
    if (!loaded) return;
    const save = () => {
      const zoom = getAppliedAppZoom();
      if (zoom === savedZoom.current) return;
      savedZoom.current = zoom;
      echoes.current = [...echoes.current.slice(-9), zoom];
      void writeDevicePreference("app.zoom", appZoomRenderScale(zoom)).catch(() => undefined);
    };
    window.addEventListener(appZoomChangedEvent, save);
    return () => window.removeEventListener(appZoomChangedEvent, save);
  }, [loaded]);
}
