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
  AppearancePreferences,
  NotificationPreferences,
  GeneralPreferences,
  AssistantPreferences,
  ShortcutPreferences,
  AdvancedPreferences,
  SearchMaintenancePreferences,
  SettingsStore,
} from "@/models/interfaces/stores/app/useSettingsStore";

export type SettingsSection =
  | "general"
  | "app"
  | "assistant"
  | "appearance"
  | "privacy"
  | "transfers"
  | "search"
  | "notifications"
  | "shortcuts"
  | "advanced";

export type SettingValue =
  string | number | boolean | Record<string, unknown> | Array<Record<string, unknown>>;

export type SettingsScaleToken = "small" | "default" | "large";
