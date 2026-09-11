import { booleanSetting, numberSetting, stringSetting } from "@/features/settings/settingsControls";

export function selectPaneFocusPreferences(document?: Record<string, unknown> | null) {
  const source = document ?? {};
  const raw = stringSetting(source, "appearance", "pane_focus_indicator", "none");
  return {
    dim: booleanSetting(source, "appearance", "dim_inactive_panes", true),
    strength: Math.min(
      0.4,
      Math.max(0, numberSetting(source, "appearance", "pane_dim_strength", 0.15)),
    ),
    indicator: raw === "outline" || raw === "border" ? raw : "none",
  } as const;
}
