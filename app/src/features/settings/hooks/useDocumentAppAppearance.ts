import { setNativeWallpaperVideo } from "@/native";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { setAppZoom } from "@/shared/hooks/useAppZoom";
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
    root.dataset.theme = "dark";
    root.dataset.mistyTheme = "warm-charcoal";
    root.dataset.themeMode = "dark";
    root.classList.add("dark");
    root.style.colorScheme = "dark";
    root.dataset.compactMode = String(appearance.compactModeEnabled);
    root.dataset.thumbnailPreviews = String(appearance.thumbnailPreviewsEnabled);
    root.dataset.wallpaperActive = String(Boolean(appearance.wallpaperPath));
    root.style.setProperty("--misty-panel-opacity", String(appearance.panelOpacity));
  }, [appearance]);

  useEffect(() => {
    setAppZoom(appearance.appZoom);
  }, [appearance.appZoom]);

  useEffect(() => {
    // The wallpaper plays on a native layer behind the transparent webview,
    // so it is applied through the Tauri command rather than the DOM.
    if (!hasTauriInternals()) return;
    void setNativeWallpaperVideo(null, appearance.wallpaperPath || null).catch(() => undefined);
  }, [appearance.wallpaperPath]);
}
