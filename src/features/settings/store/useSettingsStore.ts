import {
  definitionForLegacy,
  validPreference,
  projectPreferences,
  type PreferenceValues,
} from "../devicePreferences/registry";
import { writeDevicePreference } from "../devicePreferences/bridge";
import {
  hydrateShortcutsSnapshot,
  settingsApplyLaunchOnLogin,
  settingsLaunchOnLoginSnapshot,
  settingsSave,
  settingsSnapshot,
  shortcutsReplace,
  shortcutsSnapshot,
} from "@/native";
import type {
  LaunchOnLoginSnapshot,
  ReassignShortcutRequest,
  ResetShortcutRequest,
  SettingsSnapshot,
  ShortcutsSnapshot,
  UpdateShortcutRequest,
} from "@/native/ipc";
import { errorText } from "@/shared/lib/format";
import { create } from "zustand";
import type { SettingsSection, SettingValue } from "../types/store";
import { settingsBoolean } from "./preferences";
import { applySettingsSideEffects, currentShortcutOverrides } from "./settingsSideEffects";
export type { SettingsSection, SettingValue } from "../types/store";
export * from "./preferences";

let settingsLoad: Promise<void> | null = null;
let settingsWriteQueue: Promise<unknown> = Promise.resolve();
/** The overrides the native shortcut store holds; the UI may already show newer ones. */
let nativeShortcutOverrides = "[]";
/** Set while an edit is on screen but not yet saved, so a reload from disk cannot show older values. */
let unsavedPreview = false;
async function saveLocalDocument(document: Record<string, unknown>): Promise<SettingsSnapshot> {
  return settingsSave({ document });
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  activeSection: "general",
  settings: null,
  launchOnLogin: null,
  shortcuts: null,
  loaded: false,
  working: false,
  error: null,
  message: null,

  load: async () => {
    if (settingsLoad) return settingsLoad;
    settingsLoad = (async () => {
      // Only the first load blocks controls; reloads keep the current values usable.
      set({ working: !get().loaded, error: null });
      try {
        const [settings, shortcuts, launchOnLogin] = await Promise.all([
          settingsSnapshot(),
          shortcutsSnapshot(),
          settingsLaunchOnLoginSnapshot(),
        ]);
        if (
          shortcuts &&
          !(settings.document.shortcuts as Record<string, unknown> | undefined)?.overrides_json
        ) {
          settings.document.shortcuts = {
            ...((settings.document.shortcuts as Record<string, unknown>) ?? {}),
            overrides_json: JSON.stringify(shortcuts.overrides),
          };
        }
        nativeShortcutOverrides = JSON.stringify(shortcuts?.overrides ?? []);
        if (unsavedPreview) set({ launchOnLogin });
        else {
          applySettingsSideEffects(settings.document, false);
          set({ settings, launchOnLogin, shortcuts });
        }
      } catch (error) {
        set({ error: errorText(error) });
      } finally {
        set({ working: false, loaded: true });
      }
    })().finally(() => {
      settingsLoad = null;
    });
    return settingsLoad;
  },

  setActiveSection: (activeSection) => set({ activeSection }),

  // In-memory only, so controls and runtime behavior change on the same frame as the edit.
  previewPreferenceValues: (values) => {
    const current = get().settings;
    if (!current) return;
    const document = projectPreferences(current.document, values);
    unsavedPreview = true;
    applySettingsSideEffects(document);
    set({ settings: { ...current, document } });
    const shortcuts = get().shortcuts;
    const overrides = currentShortcutOverrides(document, null);
    if (shortcuts && JSON.stringify(overrides) !== JSON.stringify(shortcuts.overrides)) {
      set({ shortcuts: hydrateShortcutsSnapshot({ path: shortcuts.configPath, overrides }) });
      window.dispatchEvent(new CustomEvent("misty://shortcuts-changed"));
    }
  },

  applyPreferenceValues: async (values, valid = () => true) => {
    const apply = async () => {
      if (!valid()) return;
      const current = get().settings;
      const document = projectPreferences(current?.document ?? {}, values);
      const saved = await saveLocalDocument(document);
      if (!valid()) return;
      unsavedPreview = false;
      applySettingsSideEffects(saved.document);
      set({ settings: saved });
      const desired = settingsBoolean(saved.document, "general", "launch_on_login", false);
      const launch = get().launchOnLogin;
      if (launch?.supported && launch.enabled !== desired) {
        const applied = await settingsApplyLaunchOnLogin(desired);
        if (!valid()) return;
        set({ launchOnLogin: applied });
      }
      const overrides = currentShortcutOverrides(saved.document, null);
      if (JSON.stringify(overrides) !== nativeShortcutOverrides) {
        const shortcuts = await shortcutsReplace(overrides);
        nativeShortcutOverrides = JSON.stringify(shortcuts.overrides);
        if (!valid()) return;
        set({ shortcuts });
        window.dispatchEvent(new CustomEvent("misty://shortcuts-changed"));
      }
    };
    settingsWriteQueue = settingsWriteQueue.catch(() => {}).then(apply);
    await settingsWriteQueue;
  },

  updateSetting: (section, key, value) => {
    const definition = definitionForLegacy(section, key);
    if (definition) {
      const converted =
        definition.legacyValues && typeof value === "number"
          ? definition.legacyValues[value]
          : value;
      if (!validPreference(definition, converted)) {
        set({ error: `Invalid value for ${definition.label}` });
        return;
      }
      void writeDevicePreference(definition.id, converted, { stage: true }).catch((error) =>
        set({ error: errorText(error) }),
      );
      return;
    }
    set({ error: `Unknown setting: ${section}.${key}` });
  },

  updateShortcut: async (request) => {
    const overrides = currentShortcutOverrides(get().settings?.document, get().shortcuts);
    const entry = overrides.find((entry) => entry.commandId === request.commandId);
    if (entry) entry[request.slot] = request.value;
    else overrides.push({ commandId: request.commandId, [request.slot]: request.value });
    try {
      await writeDevicePreference("app.shortcuts.bindings", JSON.stringify(overrides), {
        stage: true,
      });
    } catch (error) {
      set({ error: errorText(error) });
    }
  },
  reassignShortcut: async (request) => {
    const overrides = currentShortcutOverrides(get().settings?.document, get().shortcuts);
    for (const [commandId, slot, value] of [
      [request.conflictingCommandId, request.conflictingSlot, null],
      [request.commandId, request.slot, request.value],
    ] as const) {
      const entry = overrides.find((entry) => entry.commandId === commandId);
      if (entry) entry[slot] = value;
      else overrides.push({ commandId, [slot]: value });
    }
    try {
      await writeDevicePreference("app.shortcuts.bindings", JSON.stringify(overrides), {
        stage: true,
      });
    } catch (error) {
      set({ error: errorText(error) });
    }
  },
  resetShortcuts: async (request = {}) => {
    const ids = new Set(request.commandId ? [request.commandId] : (request.commandIds ?? []));
    const overrides = ids.size
      ? currentShortcutOverrides(get().settings?.document, get().shortcuts).filter(
          (entry) => !ids.has(entry.commandId),
        )
      : [];
    try {
      await writeDevicePreference("app.shortcuts.bindings", JSON.stringify(overrides), {
        stage: true,
      });
    } catch (error) {
      set({ error: errorText(error) });
    }
  },
}));

export interface SettingsStore {
  activeSection: SettingsSection;
  settings: SettingsSnapshot | null;
  launchOnLogin: LaunchOnLoginSnapshot | null;
  shortcuts: ShortcutsSnapshot | null;
  loaded: boolean;
  working: boolean;
  error: string | null;
  message: string | null;
  setActiveSection: (section: SettingsSection) => void;
  load: () => Promise<void>;
  previewPreferenceValues: (values: PreferenceValues) => void;
  applyPreferenceValues: (values: PreferenceValues, valid?: () => boolean) => Promise<void>;
  updateSetting: (section: string, key: string, value: SettingValue) => void;
  updateShortcut: (request: UpdateShortcutRequest) => Promise<void>;
  reassignShortcut: (request: ReassignShortcutRequest) => Promise<void>;
  resetShortcuts: (request?: ResetShortcutRequest) => Promise<void>;
}
