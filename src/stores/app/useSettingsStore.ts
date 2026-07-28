import type {
  SettingsSection,
  SettingValue,
  SettingsScaleToken,
} from "@/models/types/stores/app/useSettingsStore";
export type {
  SettingsSection,
  SettingValue,
  SettingsScaleToken,
} from "@/models/types/stores/app/useSettingsStore";
import type {
  AppearancePreferences,
  NotificationPreferences,
  GeneralPreferences,
  AgentPreferences,
  ShortcutPreferences,
  AdvancedPreferences,
  SearchMaintenancePreferences,
  SettingsStore,
} from "@/models/interfaces/stores/app/useSettingsStore";
export type {
  AppearancePreferences,
  NotificationPreferences,
  GeneralPreferences,
  AgentPreferences,
  ShortcutPreferences,
  AdvancedPreferences,
  SearchMaintenancePreferences,
  SettingsStore,
} from "@/models/interfaces/stores/app/useSettingsStore";
import { create } from "zustand";
import {
  settingsOpenWithAssociations,
  settingsRemoveOpenWithAssociation,
  settingsApplyLaunchOnLogin,
  settingsLaunchOnLoginSnapshot,
  settingsSave,
  settingsSnapshot,
  shortcutsSave,
  shortcutsSnapshot,
} from "@/stores/backend";
import type {
  LaunchOnLoginSnapshot,
  OpenWithAssociation,
  ShortcutsSnapshot,
  SettingsSnapshot,
} from "@/models/interfaces/services/misty-api";
import { errorText } from "@/lib/format";
import { isNativeMobileBuild } from "@/platform/buildTarget";
import { settingsIndexToThemeMode, useAppThemeStore } from "./useAppThemeStore";
import { telemetryPreferencesChanged } from "@/analytics/lifecycle";

const defaultAdvancedServerAddress = isNativeMobileBuild ? "" : "localhost:50051";
const deviceNotificationsKey = "device_notifications_enabled";
const legacyDesktopNotificationsKey = ["desktop", "notifications", "enabled"].join("_");

let settingsSaveSequence = 0;

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  activeSection: "general",
  settings: null,
  settingsText: "{}",
  launchOnLogin: null,
  openWithAssociations: [],
  shortcuts: null,
  loaded: false,
  working: false,
  error: null,
  message: null,

  load: async () => {
    set({ working: true, error: null });
    try {
      const [settings, shortcuts, openWithAssociations, launchOnLogin] = await Promise.all([
        settingsSnapshot(),
        shortcutsSnapshot(),
        settingsOpenWithAssociations(),
        settingsLaunchOnLoginSnapshot(),
      ]);
      const normalizedSettings = settingsWithLaunchOnLoginSnapshot(settings, launchOnLogin);
      applySettingsSideEffects(normalizedSettings.document);
      set({
        settings: normalizedSettings,
        settingsText: JSON.stringify(normalizedSettings.document, null, 2),
        launchOnLogin,
        openWithAssociations,
        shortcuts,
      });
      if (normalizedSettings !== settings) {
        void settingsSave({ document: normalizedSettings.document }).catch(() => undefined);
      }
    } catch (error) {
      set({ error: errorText(error) });
    } finally {
      set({ working: false, loaded: true });
    }
  },

  setActiveSection: (activeSection) => set({ activeSection }),

  setSettingsText: (settingsText) => set({ settingsText }),

  updateSetting: (section, key, value) => {
    const requestId = ++settingsSaveSequence;
    const current = get().settings;
    const document = cloneDocument(current?.document ?? {});
    const sectionValue = document[section];
    const sectionDocument =
      sectionValue && typeof sectionValue === "object" && !Array.isArray(sectionValue)
        ? { ...(sectionValue as Record<string, unknown>) }
        : {};
    sectionDocument[key] = value;
    document[section] = sectionDocument;

    set({
      settings: current ? { ...current, document } : { path: "", document },
      settingsText: JSON.stringify(document, null, 2),
      error: null,
      message: null,
    });

    const applyNativeSetting =
      section === "general" && key === "launch_on_login"
        ? settingsApplyLaunchOnLogin(Boolean(value))
        : Promise.resolve<LaunchOnLoginSnapshot | null>(null);

    void applyNativeSetting
      .then((launchOnLogin) =>
        settingsSave({ document }).then((settings) => ({ settings, launchOnLogin })),
      )
      .then(({ settings, launchOnLogin }) => {
        if (requestId !== settingsSaveSequence) return;
        applySettingsSideEffects(settings.document);
        set({
          settings,
          settingsText: JSON.stringify(settings.document, null, 2),
          ...(launchOnLogin ? { launchOnLogin } : {}),
        });
      })
      .catch((error) => {
        if (requestId !== settingsSaveSequence) return;
        set({
          settings: current,
          settingsText: JSON.stringify(current?.document ?? {}, null, 2),
          error: errorText(error),
        });
      });
  },

  saveSettingsDocument: async () => {
    set({ working: true, error: null, message: null });
    try {
      const parsed = JSON.parse(get().settingsText) as unknown;
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
        throw new Error("Settings must be a JSON object.");
      }
      await applyLaunchOnLoginFromDocument(parsed as Record<string, unknown>);
      const settings = await settingsSave({ document: parsed as Record<string, unknown> });
      applySettingsSideEffects(settings.document);
      set({
        settings,
        settingsText: JSON.stringify(settings.document, null, 2),
        openWithAssociations: await settingsOpenWithAssociations(),
        message: "Settings saved.",
      });
    } catch (error) {
      set({ error: errorText(error) });
    } finally {
      set({ working: false });
    }
  },

  removeOpenWithAssociation: async (key) => {
    set({ working: true, error: null, message: null });
    try {
      const settings = await settingsRemoveOpenWithAssociation(key);
      set({
        settings,
        settingsText: JSON.stringify(settings.document, null, 2),
        openWithAssociations: await settingsOpenWithAssociations(),
        message: `Removed Open With association for ${key}.`,
      });
    } catch (error) {
      set({ error: errorText(error) });
    } finally {
      set({ working: false });
    }
  },

  setShortcut: (commandId, shortcut) => {
    set((state) => {
      if (!state.shortcuts) return state;
      return {
        shortcuts: {
          ...state.shortcuts,
          bindings: state.shortcuts.bindings.map((binding) =>
            binding.commandId === commandId ? { ...binding, shortcut, source: "user" } : binding,
          ),
        },
      };
    });
  },

  saveShortcuts: async () => {
    const { shortcuts } = get();
    if (!shortcuts) return;
    set({ working: true, error: null, message: null });
    try {
      set({
        shortcuts: await shortcutsSave({ bindings: shortcuts.bindings }),
        message: "Shortcuts saved.",
      });
    } catch (error) {
      set({ error: errorText(error) });
    } finally {
      set({ working: false });
    }
  },
}));

function cloneDocument(document: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(document)) as Record<string, unknown>;
}

function settingsWithLaunchOnLoginSnapshot(
  settings: SettingsSnapshot,
  launchOnLogin: LaunchOnLoginSnapshot,
): SettingsSnapshot {
  if (!launchOnLogin.supported) return settings;
  const current = settingsBoolean(settings.document, "general", "launch_on_login", false);
  if (current === launchOnLogin.enabled) return settings;

  const document = cloneDocument(settings.document);
  const sectionValue = document.general;
  document.general =
    sectionValue && typeof sectionValue === "object" && !Array.isArray(sectionValue)
      ? { ...(sectionValue as Record<string, unknown>), launch_on_login: launchOnLogin.enabled }
      : { launch_on_login: launchOnLogin.enabled };
  return { ...settings, document };
}

function applySettingsSideEffects(document: Record<string, unknown>): void {
  useAppThemeStore
    .getState()
    .setThemeMode(
      settingsIndexToThemeMode(settingsNumber(document, "appearance", "theme_index", 0)),
    );
  telemetryPreferencesChanged(
    settingsBoolean(document, "privacy", "anonymous_usage_analytics_enabled", false),
    settingsBoolean(document, "privacy", "anonymous_error_reporting_enabled", false),
  );
}

async function applyLaunchOnLoginFromDocument(document: Record<string, unknown>): Promise<void> {
  await settingsApplyLaunchOnLogin(settingsBoolean(document, "general", "launch_on_login", false));
}

export function selectAppearancePreferences(
  document: Record<string, unknown> | null | undefined,
): AppearancePreferences {
  const source = document ?? {};
  return {
    compactModeEnabled: settingsBoolean(source, "appearance", "compact_mode_enabled", false),
    fontSize: settingsScaleToken(settingsNumber(source, "appearance", "font_size_index", 1)),
    panelOpacity: clampSettingsNumber(
      settingsNumber(source, "appearance", "panel_opacity", 0.82),
      0,
      1,
    ),
    reducedMotionEnabled: settingsBoolean(source, "appearance", "reduced_motion_enabled", false),
    thumbnailPreviewsEnabled: settingsBoolean(
      source,
      "appearance",
      "thumbnail_previews_enabled",
      true,
    ),
    uiScale: settingsScaleToken(settingsNumber(source, "appearance", "ui_scale_index", 1)),
    wallpaperPath: settingsString(source, "appearance", "wallpaper_path", ""),
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
    automaticImageDiscoveryEnabled: settingsBoolean(
      source,
      "search",
      "automatic_image_discovery_enabled",
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
