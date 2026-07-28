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
import { settingsIndexToThemeMode, useAppThemeStore } from "@/stores/app";
import { telemetryPreferencesChanged } from "@/analytics/lifecycle";

import type {
  SettingsSection,
  SettingValue,
  SettingsScaleToken,
} from "@/models/types/stores/app/useSettingsStore";

export interface AppearancePreferences {
  compactModeEnabled: boolean;
  fontSize: SettingsScaleToken;
  panelOpacity: number;
  reducedMotionEnabled: boolean;
  thumbnailPreviewsEnabled: boolean;
  uiScale: SettingsScaleToken;
  wallpaperPath: string;
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
  automaticImageDiscoveryEnabled: boolean;
  discoveryIntervalMinutes: number;
}

export interface SettingsStore {
  activeSection: SettingsSection;
  settings: SettingsSnapshot | null;
  settingsText: string;
  launchOnLogin: LaunchOnLoginSnapshot | null;
  openWithAssociations: OpenWithAssociation[];
  shortcuts: ShortcutsSnapshot | null;
  loaded: boolean;
  working: boolean;
  error: string | null;
  message: string | null;
  setActiveSection: (section: SettingsSection) => void;
  load: () => Promise<void>;
  setSettingsText: (value: string) => void;
  updateSetting: (section: string, key: string, value: SettingValue) => void;
  saveSettingsDocument: () => Promise<void>;
  removeOpenWithAssociation: (key: string) => Promise<void>;
  setShortcut: (commandId: string, shortcut: string) => void;
  saveShortcuts: () => Promise<void>;
}
