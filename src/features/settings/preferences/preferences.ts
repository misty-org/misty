import { appZoomFromStoredScale, appZoomStoredDefault } from "@/shared/hooks/useAppZoom";
// From the readers' own module, which imports nothing: SettingsControls (which also re-exports
// them) sits in import cycles, and aliasing through it could copy them before they exist.
import { booleanSetting, numberSetting, stringSetting } from "../settingsValues";
import type { AppThemeMode } from "./appTheme";
import type { NightLightMode } from "./nightLight";
export const settingsBoolean = booleanSetting;
export const settingsNumber = numberSetting;
export const settingsString = stringSetting;
export function selectAppearancePreferences(
  document: Record<string, unknown> | null | undefined,
): AppearancePreferences {
  const source = document ?? {};
  return {
    appZoom: appZoomFromStoredScale(
      settingsNumber(source, "appearance", "app_zoom", appZoomStoredDefault),
    ),
    compactModeEnabled: settingsBoolean(source, "appearance", "compact_mode_enabled", false),
    reduceMotion: settingsBoolean(source, "appearance", "reduce_motion", false),
    themeMode: themeMode(settingsString(source, "appearance", "theme_mode", "dark")),
    nightLightMode: nightLightMode(settingsString(source, "appearance", "night_light_mode", "off")),
    nightLightStart: settingsString(source, "appearance", "night_light_start", "21:00"),
    nightLightEnd: settingsString(source, "appearance", "night_light_end", "07:00"),
    nightLightWarmth: settingsNumber(source, "appearance", "night_light_warmth", 0.5),
  };
}
function themeMode(value: string): AppThemeMode {
  return value === "system" || value === "light" ? value : "dark";
}
function nightLightMode(value: string): NightLightMode {
  return value === "on" || value === "scheduled" ? value : "off";
}
interface AppearancePreferences {
  appZoom: number;
  compactModeEnabled: boolean;
  reduceMotion: boolean;
  themeMode: AppThemeMode;
  nightLightMode: NightLightMode;
  nightLightStart: string;
  nightLightEnd: string;
  nightLightWarmth: number;
}
