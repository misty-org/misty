import { appZoomBaseline, appZoomFromStoredScale } from "@/shared/hooks/useAppZoom";
import { workspaceDefaultViewIndex } from "@/features/workspace/workspaceDefaultView";
import { booleanSetting, numberSetting, stringSetting } from "../SettingsControls";
import type { AppThemeMode } from "./appTheme";
export const settingsBoolean = booleanSetting;
export const settingsNumber = numberSetting;
export const settingsString = stringSetting;
export function selectAppearancePreferences(
  document: Record<string, unknown> | null | undefined,
): AppearancePreferences {
  const source = document ?? {};
  return {
    appZoom: appZoomFromStoredScale(
      settingsNumber(source, "appearance", "app_zoom", appZoomBaseline),
    ),
    compactModeEnabled: settingsBoolean(source, "appearance", "compact_mode_enabled", false),
    navigatorAutoHide: settingsBoolean(source, "appearance", "navigator_auto_hide", false),
    themeMode: themeMode(settingsString(source, "appearance", "theme_mode", "dark")),
    themeLightAt: settingsString(source, "appearance", "theme_light_start", "07:00"),
    themeDarkAt: settingsString(source, "appearance", "theme_dark_start", "19:00"),
  };
}
export function selectGeneralPreferences(
  document: Record<string, unknown> | null | undefined,
): GeneralPreferences {
  const source = document ?? {};
  return {
    preferredWorkspaceRoot: settingsString(source, "general", "preferred_workspace_root", ""),
    reopenLastSession: settingsBoolean(source, "general", "reopen_last_session", true),
    searchEngineIndex: settingsNumber(source, "general", "browser_search_engine_index", 0),
    startupViewIndex: settingsNumber(source, "general", "startup_view_index", 0),
    workspaceDefaultTabIndex: settingsNumber(
      source,
      "general",
      "workspace_default_tab_index",
      workspaceDefaultViewIndex,
    ),
  };
}
export function selectShortcutPreferences(
  document: Record<string, unknown> | null | undefined,
): ShortcutPreferences {
  const source = document ?? {};
  return {
    shortcutHintsEnabled: settingsBoolean(source, "shortcuts", "shortcut_hints_enabled", true),
  };
}
export function selectAdvancedPreferences(
  document: Record<string, unknown> | null | undefined,
): AdvancedPreferences {
  const source = document ?? {};
  return {
    mountPath: settingsString(source, "advanced", "mount_path", ".misty/mnt"),
  };
}
function themeMode(value: string): AppThemeMode {
  return value === "system" || value === "light" || value === "scheduled" ? value : "dark";
}
export interface AppearancePreferences {
  appZoom: number;
  compactModeEnabled: boolean;
  navigatorAutoHide: boolean;
  themeMode: AppThemeMode;
  themeLightAt: string;
  themeDarkAt: string;
}
export interface GeneralPreferences {
  preferredWorkspaceRoot: string;
  reopenLastSession: boolean;
  searchEngineIndex: number;
  startupViewIndex: number;
  workspaceDefaultTabIndex: number;
}
export interface ShortcutPreferences {
  shortcutHintsEnabled: boolean;
}
export interface AdvancedPreferences {
  mountPath: string;
}
