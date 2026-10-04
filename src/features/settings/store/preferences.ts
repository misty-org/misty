import { appZoomBaseline, appZoomFromStoredScale } from "@/shared/hooks/useAppZoom";
import { workspaceDefaultViewIndex } from "@/features/workspace/workspaceDefaultView";
import { booleanSetting, numberSetting, stringSetting } from "../SettingsControls";
export const settingsBoolean = booleanSetting;
export const settingsNumber = numberSetting;
export const settingsString = stringSetting;
const legacyDesktopNotificationsKey = ["desktop", "notifications", "enabled"].join("_");
export const notificationsDeviceKey = legacyDesktopNotificationsKey;
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
    panelOpacity: clampSettingsNumber(
      settingsNumber(source, "appearance", "panel_opacity", 0.82),
      0.4,
      1,
    ),
    thumbnailPreviewsEnabled: settingsBoolean(
      source,
      "appearance",
      "thumbnail_previews_enabled",
      true,
    ),
    wallpaperPath: settingsString(source, "appearance", "wallpaper_path", ""),
  };
}
export function selectFilePreferences(
  document: Record<string, unknown> | null | undefined,
): FilePreferences {
  const source = document ?? {};
  return {
    defaultViewModeIndex: settingsNumber(source, "files", "default_view_mode_index", 0),
    showHiddenFiles: settingsBoolean(source, "files", "show_hidden_files", false),
  };
}
export function selectNotificationPreferences(
  document: Record<string, unknown> | null | undefined,
): NotificationPreferences {
  const source = document ?? {};
  const deviceNotificationsEnabled = settingsBoolean(
    source,
    "notifications",
    legacyDesktopNotificationsKey,
    true,
  );
  return {
    badgeCountEnabled: settingsBoolean(source, "notifications", "badge_count_enabled", true),
    desktopNotificationsEnabled: deviceNotificationsEnabled,
    digestNotificationsEnabled: settingsBoolean(
      source,
      "notifications",
      "digest_notifications_enabled",
      false,
    ),
    inAppNotificationsEnabled: settingsBoolean(
      source,
      "notifications",
      "in_app_notifications_enabled",
      true,
    ),
    quietHoursEnabled: settingsBoolean(source, "notifications", "quiet_hours_enabled", false),
    soundNotificationsEnabled: settingsBoolean(
      source,
      "notifications",
      "sound_notifications_enabled",
      false,
    ),
  };
}
export function selectGeneralPreferences(
  document: Record<string, unknown> | null | undefined,
): GeneralPreferences {
  const source = document ?? {};
  return {
    confirmDestructiveActions: settingsBoolean(
      source,
      "general",
      "confirm_destructive_actions",
      true,
    ),
    defaultFileActionIndex: settingsNumber(source, "general", "default_file_action_index", 0),
    openLinksExternally: settingsBoolean(source, "general", "open_links_externally", false),
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
export function selectSearchMaintenancePreferences(
  document: Record<string, unknown> | null | undefined,
): SearchMaintenancePreferences {
  const source = document ?? {};
  return {
    automaticFileDiscoveryEnabled: settingsBoolean(
      source,
      "search",
      "automatic_file_discovery_enabled",
      true,
    ),
    discoveryIntervalMinutes: clampSettingsNumber(
      settingsNumber(source, "search", "discovery_interval_minutes", 15),
      5,
      240,
    ),
    ignoredPaths: parsePathList(settingsString(source, "search", "ignored_paths", "")),
    includeHidden: settingsBoolean(source, "search", "include_hidden", false),
    maxDepth: clampSettingsNumber(settingsNumber(source, "search", "max_depth", 18), 1, 64),
  };
}

/** Newline- or comma-separated in the settings field, a list everywhere else. */
export function parsePathList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}
function clampSettingsNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
export interface AppearancePreferences {
  appZoom: number;
  compactModeEnabled: boolean;
  navigatorAutoHide: boolean;
  panelOpacity: number;
  thumbnailPreviewsEnabled: boolean;
  wallpaperPath: string;
}
export interface FilePreferences {
  defaultViewModeIndex: number;
  showHiddenFiles: boolean;
}
export interface NotificationPreferences {
  badgeCountEnabled: boolean;
  desktopNotificationsEnabled: boolean;
  digestNotificationsEnabled: boolean;
  inAppNotificationsEnabled: boolean;
  quietHoursEnabled: boolean;
  soundNotificationsEnabled: boolean;
}
export interface GeneralPreferences {
  confirmDestructiveActions: boolean;
  defaultFileActionIndex: number;
  openLinksExternally: boolean;
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
export interface SearchMaintenancePreferences {
  automaticFileDiscoveryEnabled: boolean;
  discoveryIntervalMinutes: number;
  ignoredPaths: string[];
  includeHidden: boolean;
  maxDepth: number;
}
