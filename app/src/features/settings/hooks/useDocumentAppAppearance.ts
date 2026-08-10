import { selectAppearancePreferences } from "../store/preferences";
import { useSettingsStore } from "../store/useSettingsStore";
import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";

export function useDocumentAppAppearance() {
  const appearancePreferences = useSettingsStore(
    useShallow((state) => selectAppearancePreferences(state.settings?.document)),
  );
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = "dark";
    root.dataset.mistyTheme = "warm-charcoal";
    root.dataset.themeMode = "dark";
    root.classList.add("dark");
    root.dataset.compactMode = String(appearancePreferences.compactModeEnabled);
    root.dataset.fontSize = appearancePreferences.fontSize;
    root.dataset.reducedMotion = String(appearancePreferences.reducedMotionEnabled);
    root.dataset.thumbnailPreviews = String(appearancePreferences.thumbnailPreviewsEnabled);
    root.dataset.uiScale = appearancePreferences.uiScale;
    root.style.colorScheme = "dark";
  }, [appearancePreferences]);
}
