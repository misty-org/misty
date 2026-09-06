import {
  settingsApplyLaunchOnLogin,
  settingsLaunchOnLoginSnapshot,
  settingsOpenWithAssociations,
  settingsRemoveOpenWithAssociation,
  settingsSave,
  settingsSnapshot,
  shortcutsReset,
  shortcutsReassign,
  shortcutsSnapshot,
  shortcutsUpdate,
} from "@/native";
import type {
  LaunchOnLoginSnapshot,
  OpenWithAssociation,
  ReassignShortcutRequest,
  ResetShortcutRequest,
  SettingsSnapshot,
  ShortcutsSnapshot,
  UpdateShortcutRequest,
} from "@/native/contracts";
import { configureStartupPreference } from "@/features/app-shell";
import { configureBrowserHomeUrl } from "@/features/workspace/browserHome";
import { configureBrowserSearchEngine } from "@/features/workspace/browserSearchEngine";
import { configureWorkspaceDefaultTab } from "@/features/workspace/workspaceDefaultTab";
import { telemetryPreferencesChanged } from "@/telemetry/lifecycle";
import { errorText } from "@/shared/lib/format";
import { configureExternalLinkPreference } from "@/shared/platform/openExternalLink";
import { create } from "zustand";
import type { SettingsSection, SettingValue } from "../types/store";
import {
  selectGeneralPreferences,
  settingsBoolean,
  settingsNumber,
  settingsString,
} from "./preferences";
export type { SettingsSection, SettingValue } from "../types/store";
export * from "./preferences";

let settingsSaveSequence = 0;

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  activeSection: "general",
  settings: null,
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
          ...(launchOnLogin ? { launchOnLogin } : {}),
        });
      })
      .catch((error) => {
        if (requestId !== settingsSaveSequence) return;
        set({
          settings: current,
          error: errorText(error),
        });
      });
  },

  removeOpenWithAssociation: async (key) => {
    set({ working: true, error: null, message: null });
    try {
      const settings = await settingsRemoveOpenWithAssociation(key);
      set({
        settings,
        openWithAssociations: await settingsOpenWithAssociations(),
        message: `Removed Open With association for ${key}.`,
      });
    } catch (error) {
      set({ error: errorText(error) });
    } finally {
      set({ working: false });
    }
  },

  updateShortcut: async (request) => {
    const previous = get().shortcuts;
    if (!previous) return;
    set({ shortcuts: optimisticShortcutUpdate(previous, request), error: null, message: null });
    try {
      set({
        shortcuts: await shortcutsUpdate(request),
        message: "Shortcut updated.",
      });
      window.dispatchEvent(new CustomEvent("misty://shortcuts-changed"));
    } catch (error) {
      set({ shortcuts: previous, error: errorText(error) });
    }
  },

  reassignShortcut: async (request) => {
    const previous = get().shortcuts;
    if (!previous) return;
    set({ shortcuts: optimisticShortcutReassign(previous, request), error: null, message: null });
    try {
      set({
        shortcuts: await shortcutsReassign(request),
        message: "Shortcut reassigned.",
      });
      window.dispatchEvent(new CustomEvent("misty://shortcuts-changed"));
    } catch (error) {
      set({ shortcuts: previous, error: errorText(error) });
    }
  },

  resetShortcuts: async (request = {}) => {
    const previous = get().shortcuts;
    set({ working: true, error: null, message: null });
    try {
      set({ shortcuts: await shortcutsReset(request), message: "Shortcuts restored to defaults." });
      window.dispatchEvent(new CustomEvent("misty://shortcuts-changed"));
    } catch (error) {
      set({ shortcuts: previous, error: errorText(error) });
    } finally {
      set({ working: false });
    }
  },
}));

function optimisticShortcutUpdate(
  snapshot: ShortcutsSnapshot,
  request: UpdateShortcutRequest,
): ShortcutsSnapshot {
  const effectiveBindings = snapshot.effectiveBindings.map((binding) =>
    binding.commandId === request.commandId
      ? {
          ...binding,
          [request.slot]: request.value,
          [`${request.slot}Source`]: "user",
        }
      : binding,
  );
  return {
    ...snapshot,
    effectiveBindings,
    bindings: effectiveBindings.flatMap((binding) =>
      binding.primary
        ? [
            {
              commandId: binding.commandId,
              shortcut: binding.primary,
              source: binding.primarySource,
            },
          ]
        : [],
    ),
  };
}

function optimisticShortcutReassign(
  snapshot: ShortcutsSnapshot,
  request: ReassignShortcutRequest,
): ShortcutsSnapshot {
  return optimisticShortcutUpdate(
    optimisticShortcutUpdate(snapshot, {
      commandId: request.conflictingCommandId,
      slot: request.conflictingSlot,
      value: null,
    }),
    request,
  );
}

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
  telemetryPreferencesChanged(
    settingsBoolean(document, "privacy", "anonymous_usage_analytics_enabled", false),
    settingsBoolean(document, "privacy", "anonymous_error_reporting_enabled", false),
  );
  configureBrowserHomeUrl(settingsString(document, "general", "browser_homepage", ""));
  configureBrowserSearchEngine(
    settingsNumber(document, "general", "browser_search_engine_index", 0),
  );
  configureWorkspaceDefaultTab(
    settingsNumber(document, "general", "workspace_default_tab_index", 0),
  );
  // Mirrored to localStorage: the index route redirects before this document
  // has loaded, so it cannot read the preference from here directly.
  configureStartupPreference({
    reopenLastSession: settingsBoolean(document, "general", "reopen_last_session", true),
    startupViewIndex: settingsNumber(document, "general", "startup_view_index", 0),
  });
}

export interface SettingsStore {
  activeSection: SettingsSection;
  settings: SettingsSnapshot | null;
  launchOnLogin: LaunchOnLoginSnapshot | null;
  openWithAssociations: OpenWithAssociation[];
  shortcuts: ShortcutsSnapshot | null;
  loaded: boolean;
  working: boolean;
  error: string | null;
  message: string | null;
  setActiveSection: (section: SettingsSection) => void;
  load: () => Promise<void>;
  updateSetting: (section: string, key: string, value: SettingValue) => void;
  removeOpenWithAssociation: (key: string) => Promise<void>;
  updateShortcut: (request: UpdateShortcutRequest) => Promise<void>;
  reassignShortcut: (request: ReassignShortcutRequest) => Promise<void>;
  resetShortcuts: (request?: ResetShortcutRequest) => Promise<void>;
}

configureExternalLinkPreference(
  () =>
    selectGeneralPreferences(useSettingsStore.getState().settings?.document).openLinksExternally,
);
