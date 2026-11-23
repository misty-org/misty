import { settingsBoolean, useSettingsStore } from "@/features/settings";

export function useDesktopShellStatus() {
  return useSettingsStore((state) =>
    settingsBoolean(
      state.settings?.document ?? {},
      "advanced",
      "frame_pacing_overlay_enabled",
      false,
    ),
  );
}
