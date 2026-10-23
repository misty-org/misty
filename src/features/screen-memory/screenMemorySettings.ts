import { numberSetting, stringSetting } from "@/features/settings/SettingsControls";

export const IDLE_MINUTE_CHOICES = [10, 30, 60, 120] as const;
export const KEEP_DAY_CHOICES = [7, 30, 90] as const;

export interface ScreenMemorySettings {
  idleMinutes: number;
  excludedApps: string[];
  keepDays: number;
}

/** Settings › Memory › Screen capture, read from the device's settings document. */
export function screenMemorySettings(
  document: Record<string, unknown> | undefined,
): ScreenMemorySettings {
  const doc = document ?? {};
  return {
    idleMinutes: numberSetting(doc, "screen_memory", "idle_minutes", 30),
    excludedApps: stringSetting(doc, "screen_memory", "excluded_apps", "")
      .split("\n")
      .map((app) => app.trim())
      .filter(Boolean)
      .slice(0, 200),
    keepDays: numberSetting(doc, "screen_memory", "keep_days", 30),
  };
}
