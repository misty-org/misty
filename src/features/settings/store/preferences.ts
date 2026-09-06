import { isNativeMobileBuild } from "@/shared/platform/buildTarget";
import { appZoomDefault, appZoomMax, appZoomMin } from "@/shared/hooks/useAppZoom";
import { booleanSetting, numberSetting, sectionRecord, stringSetting } from "../settingsControls";

export const settingsBoolean = booleanSetting;
export const settingsNumber = numberSetting;
export const settingsString = stringSetting;

const deviceNotificationsKey = "device_notifications_enabled";
const legacyDesktopNotificationsKey = ["desktop", "notifications", "enabled"].join("_");
export const notificationsDeviceKey = isNativeMobileBuild
  ? deviceNotificationsKey
  : legacyDesktopNotificationsKey;

export function selectAppearancePreferences(
  document: Record<string, unknown> | null | undefined,
): AppearancePreferences {
  const source = document ?? {};
  return {
    appZoom: clampSettingsNumber(
      settingsNumber(source, "appearance", "app_zoom", appZoomDefault),
      appZoomMin,
      appZoomMax,
    ),
    compactModeEnabled: settingsBoolean(source, "appearance", "compact_mode_enabled", false),
    navigatorAutoHide: settingsBoolean(source, "appearance", "navigator_auto_hide", false),
    navigatorWidthIndex: settingsNumber(source, "appearance", "navigator_width_index", 0),
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

export function selectTerminalPreferences(
  document: Record<string, unknown> | null | undefined,
): TerminalPreferences {
  const source = document ?? {};
  return {
    cursorBlink: settingsBoolean(source, "terminal", "cursor_blink", true),
    cursorStyleIndex: settingsNumber(source, "terminal", "cursor_style_index", 0),
    fontFamily: settingsString(source, "terminal", "font_family", ""),
    fontSize: clampSettingsNumber(settingsNumber(source, "terminal", "font_size", 13), 8, 32),
    scrollback: clampSettingsNumber(
      settingsNumber(source, "terminal", "scrollback", 50_000),
      1_000,
      500_000,
    ),
  };
}

export function selectEditorPreferences(
  document: Record<string, unknown> | null | undefined,
): EditorPreferences {
  const source = document ?? {};
  return {
    autosaveDelayMs: clampSettingsNumber(
      settingsNumber(source, "editor", "autosave_delay_ms", 1000),
      0,
      30_000,
    ),
    fontFamily: settingsString(source, "editor", "font_family", ""),
    fontSize: clampSettingsNumber(settingsNumber(source, "editor", "font_size", 14), 8, 32),
    formatOnSave: settingsBoolean(source, "editor", "format_on_save", false),
    interfaceScale:
      Math.round(
        clampSettingsNumber(settingsNumber(source, "editor", "interface_scale", 1), 0.8, 1.5) * 10,
      ) / 10,
    lineNumbers: settingsBoolean(source, "editor", "line_numbers", true),
    tabSize: clampSettingsNumber(settingsNumber(source, "editor", "tab_size", 2), 1, 8),
    theme: settingsString(source, "editor", "theme", "gruvbox-dark"),
    wordWrap: settingsBoolean(source, "editor", "word_wrap", true),
  };
}

export function selectNotificationPreferences(
  document: Record<string, unknown> | null | undefined,
): NotificationPreferences {
  const source = document ?? {};
  const deviceNotificationsEnabled = settingsBoolean(
    source,
    "notifications",
    isNativeMobileBuild ? deviceNotificationsKey : legacyDesktopNotificationsKey,
    settingsBoolean(source, "notifications", legacyDesktopNotificationsKey, true),
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
    defaultTransferBehaviorIndex: settingsNumber(
      source,
      "general",
      "default_transfer_behavior_index",
      0,
    ),
    openLinksExternally: settingsBoolean(source, "general", "open_links_externally", false),
    preferredWorkspaceRoot: settingsString(source, "general", "preferred_workspace_root", ""),
    reopenLastSession: settingsBoolean(source, "general", "reopen_last_session", true),
    searchEngineIndex: settingsNumber(source, "general", "browser_search_engine_index", 0),
    startupViewIndex: settingsNumber(source, "general", "startup_view_index", 0),
    workspaceDefaultTabIndex: settingsNumber(source, "general", "workspace_default_tab_index", 0),
  };
}

export function selectAgentPreferences(
  document: Record<string, unknown> | null | undefined,
): AgentPreferences {
  const source = document ?? {};
  // This selector is fail-closed: a missing section reads as enabled: false and
  // Agents go dark. The settings section was renamed from "assistant" to
  // "agent", so the stored document for every existing user still uses the old
  // key until they next save. Read the current key first and fall back, or the
  // rename silently disables Agents for everyone who already had them on.
  const current = sectionRecord(source, "agent");
  const agent = Object.keys(current).length > 0 ? current : sectionRecord(source, "assistant");
  const scopesValue = agent.scopes;
  const scopes =
    scopesValue && typeof scopesValue === "object" && !Array.isArray(scopesValue)
      ? (scopesValue as Record<string, unknown>)
      : {};
  return {
    enabled: agent.enabled === true,
    scopes: {
      filesAllowed: scopes.files_allowed === true,
      cleanupAllowed: scopes.cleanup_allowed === true,
      searchAllowed: scopes.search_allowed === true,
    },
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
    extensionToolsPath: settingsString(source, "advanced", "extension_tools_path", ""),
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
  navigatorWidthIndex: number;
  panelOpacity: number;
  thumbnailPreviewsEnabled: boolean;
  wallpaperPath: string;
}

export interface FilePreferences {
  defaultViewModeIndex: number;
  showHiddenFiles: boolean;
}

export interface TerminalPreferences {
  cursorBlink: boolean;
  cursorStyleIndex: number;
  fontFamily: string;
  fontSize: number;
  scrollback: number;
}

export interface EditorPreferences {
  autosaveDelayMs: number;
  fontFamily: string;
  fontSize: number;
  formatOnSave: boolean;
  interfaceScale: number;
  lineNumbers: boolean;
  tabSize: number;
  theme: string;
  wordWrap: boolean;
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
  defaultTransferBehaviorIndex: number;
  openLinksExternally: boolean;
  preferredWorkspaceRoot: string;
  reopenLastSession: boolean;
  searchEngineIndex: number;
  startupViewIndex: number;
  workspaceDefaultTabIndex: number;
}

export interface AgentPreferences {
  enabled: boolean;
  scopes: {
    filesAllowed: boolean;
    cleanupAllowed: boolean;
    searchAllowed: boolean;
  };
}

export interface ShortcutPreferences {
  shortcutHintsEnabled: boolean;
}

export interface AdvancedPreferences {
  extensionToolsPath: string;
  mountPath: string;
}

export interface SearchMaintenancePreferences {
  automaticFileDiscoveryEnabled: boolean;
  discoveryIntervalMinutes: number;
  ignoredPaths: string[];
  includeHidden: boolean;
  maxDepth: number;
}
