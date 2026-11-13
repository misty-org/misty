import { booleanSetting, numberSetting } from "@/features/settings/SettingsControls";

/** The most an inactive pane is dimmed. Dimming alone marks the focused pane. */
export const MAX_PANE_DIM = 0.5;

export function selectPaneFocusPreferences(document?: Record<string, unknown> | null) {
  const source = document ?? {};
  return {
    dim: booleanSetting(source, "appearance", "dim_inactive_panes", true),
    strength: Math.min(
      MAX_PANE_DIM,
      Math.max(0, numberSetting(source, "appearance", "pane_dim_strength", 0.15)),
    ),
  } as const;
}
