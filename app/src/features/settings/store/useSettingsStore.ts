import {
  settingsApplyLaunchOnLogin,
  settingsLaunchOnLoginSnapshot,
  settingsOpenWithAssociations,
  settingsRemoveOpenWithAssociation,
  settingsSave,
  settingsSnapshot,
  shortcutsSave,
  shortcutsSnapshot,
} from "@/native";
import type {
  LaunchOnLoginSnapshot,
  OpenWithAssociation,
  SettingsSnapshot,
  ShortcutsSnapshot,
} from "@/native/contracts";
import { telemetryPreferencesChanged } from "@/telemetry/lifecycle";
import { errorText } from "@/shared/lib/format";
import { configureExternalLinkPreference } from "@/shared/platform/openExternalLink";
import { create } from "zustand";
import type { SettingsSection, SettingValue } from "../types/store";
import { selectGeneralPreferences, settingsBoolean, settingsNumber } from "./preferences";
import { settingsIndexToThemeMode, useAppThemeStore } from "./useAppThemeStore";
export type { SettingsScaleToken, SettingsSection, SettingValue } from "../types/store";
export * from "./preferences";

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

configureExternalLinkPreference(
  () =>
    selectGeneralPreferences(useSettingsStore.getState().settings?.document).openLinksExternally,
);
