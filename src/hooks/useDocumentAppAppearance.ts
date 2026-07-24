import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { selectAppearancePreferences, useAppThemeStore, useSettingsStore } from "@/stores/app";

export function useDocumentAppAppearance() {
  const appearancePreferences = useSettingsStore(
    useShallow((state) => selectAppearancePreferences(state.settings?.document)),
  );
  const { resolvedTheme, setSystemTheme, themeId, themeMode } = useAppThemeStore(
    useShallow((state) => ({
      resolvedTheme: state.resolvedTheme,
      setSystemTheme: state.setSystemTheme,
      themeId: state.themeId,
      themeMode: state.themeMode,
    })),
  );

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolvedTheme;
    root.dataset.mistyTheme = themeId;
    root.dataset.themeMode = themeMode;
    root.classList.toggle("dark", resolvedTheme === "dark");
    root.dataset.compactMode = String(appearancePreferences.compactModeEnabled);
    root.dataset.fontSize = appearancePreferences.fontSize;
    root.dataset.reducedMotion = String(appearancePreferences.reducedMotionEnabled);
    root.dataset.thumbnailPreviews = String(appearancePreferences.thumbnailPreviewsEnabled);
    root.dataset.uiScale = appearancePreferences.uiScale;
    root.style.colorScheme = resolvedTheme;
  }, [appearancePreferences, resolvedTheme, themeId, themeMode]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: light)");
    const syncSystemTheme = () => setSystemTheme(query.matches ? "light" : "dark");
    syncSystemTheme();
    query.addEventListener("change", syncSystemTheme);
    return () => query.removeEventListener("change", syncSystemTheme);
  }, [setSystemTheme]);
}
