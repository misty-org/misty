import { isNativeMobileBuild } from "@/shared/platform/buildTarget";
import type { SettingsScaleToken } from "../types/store";

const defaultAdvancedServerAddress = isNativeMobileBuild ? "" : "localhost:50051";
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
    compactModeEnabled: settingsBoolean(source, "appearance", "compact_mode_enabled", false),
    fontSize: settingsScaleToken(settingsNumber(source, "appearance", "font_size_index", 1)),
    reducedMotionEnabled: settingsBoolean(source, "appearance", "reduced_motion_enabled", false),
    thumbnailPreviewsEnabled: settingsBoolean(
      source,
      "appearance",
      "thumbnail_previews_enabled",
      true,
    ),
    uiScale: settingsScaleToken(settingsNumber(source, "appearance", "ui_scale_index", 1)),
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
    openLinksExternally: settingsBoolean(source, "general", "open_links_externally", true),
    preferredWorkspaceRoot: settingsString(source, "general", "preferred_workspace_root", ""),
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
  const current = settingsSectionRecord(source, "agent");
  const agent =
    Object.keys(current).length > 0 ? current : settingsSectionRecord(source, "assistant");
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
    customShortcutsEnabled: settingsBoolean(source, "shortcuts", "custom_shortcuts_enabled", false),
    keymapIndex: settingsNumber(source, "shortcuts", "keymap_index", 0),
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
    serverAddress: settingsString(
      source,
      "advanced",
      "server_address",
      defaultAdvancedServerAddress,
    ),
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
  };
}

export function settingsNumber(
  document: Record<string, unknown>,
  section: string,
  key: string,
  fallback: number,
): number {
  const value = settingsSectionRecord(document, section)[key];
  return typeof value === "number" ? value : fallback;
}

export function settingsBoolean(
  document: Record<string, unknown>,
  section: string,
  key: string,
  fallback: boolean,
): boolean {
  const value = settingsSectionRecord(document, section)[key];
  return typeof value === "boolean" ? value : fallback;
}

export function settingsString(
  document: Record<string, unknown>,
  section: string,
  key: string,
  fallback: string,
): string {
  const value = settingsSectionRecord(document, section)[key];
  return typeof value === "string" ? value : fallback;
}

function settingsScaleToken(index: number): SettingsScaleToken {
  if (index === 0) return "small";
  if (index === 2) return "large";
  return "default";
}

function clampSettingsNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function settingsSectionRecord(
  document: Record<string, unknown>,
  section: string,
): Record<string, unknown> {
  const value = document[section];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export interface AppearancePreferences {
  compactModeEnabled: boolean;
  fontSize: SettingsScaleToken;
  reducedMotionEnabled: boolean;
  thumbnailPreviewsEnabled: boolean;
  uiScale: SettingsScaleToken;
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
  customShortcutsEnabled: boolean;
  keymapIndex: number;
  shortcutHintsEnabled: boolean;
}

export interface AdvancedPreferences {
  extensionToolsPath: string;
  mountPath: string;
  serverAddress: string;
}

export interface SearchMaintenancePreferences {
  automaticFileDiscoveryEnabled: boolean;
  discoveryIntervalMinutes: number;
}
