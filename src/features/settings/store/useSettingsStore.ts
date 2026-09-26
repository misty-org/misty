import { hasTauriInternals } from "@/shared/platform/tauri";
import { mutateState, readState } from "../profiles/persistence";
import {
  definitionForLegacy,
  validPreference,
  projectPreferences,
  runtimeAdapters,
  type PreferenceValues,
} from "../profiles/registry";
import { writeProfilePreference } from "../profiles/bridge";
import { configureTabHistoryBudget } from "@/features/webviews/tabHistory";
import { configurePageRestore } from "@/features/browser-workspace/pageRestoreSettings";
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
import {
  publishNavigatorLayout,
  readNavigatorLayout,
  configureStartupPreference,
} from "@/features/app-shell";
import { configureBrowserHomeUrl } from "@/features/workspace/browserHome";
import {
  configureBrowserSearchEngine,
  configureBrowserSearchSuggestions,
} from "@/features/workspace/browserSearchEngine";
import { configureWorkspaceDefaultTab } from "@/features/workspace/workspaceDefaultTab";
import {
  setBrowserDownloadDirectory,
  setBrowserDownloadPrompt,
  setBrowserStatusBubbleEnabled,
} from "@/features/webviews/browserRuntime";
import { telemetryPreferencesChanged } from "@/telemetry/lifecycle";
import { errorText } from "@/shared/lib/format";
import { create } from "zustand";
import type { SettingsSection, SettingValue } from "../types/store";
import { settingsBoolean, settingsNumber, settingsString } from "./preferences";
export type { SettingsSection, SettingValue } from "../types/store";
export * from "./preferences";

let settingsLoad: Promise<void> | null = null;
let settingsSaveSequence = 0;
let settingsWriteQueue: Promise<unknown> = Promise.resolve();
async function saveLocalDocument(document: Record<string, unknown>): Promise<SettingsSnapshot> {
  if (hasTauriInternals()) return settingsSave({ document });
  await mutateState(
    "device-settings",
    () => ({}) as Record<string, unknown>,
    () => document,
  );
  return { path: "", document };
}

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
    if (settingsLoad) return settingsLoad;
    settingsLoad = (async () => {
      set({ working: true, error: null });
      try {
        const [settings, shortcuts, openWithAssociations, launchOnLogin] = await Promise.all([
          hasTauriInternals()
            ? settingsSnapshot()
            : readState<Record<string, unknown>>("device-settings").then((s) => ({
                path: "",
                document: s.state ?? {},
              })),
          hasTauriInternals() ? shortcutsSnapshot() : Promise.resolve(null),
          hasTauriInternals() ? settingsOpenWithAssociations() : Promise.resolve([]),
          hasTauriInternals()
            ? settingsLaunchOnLoginSnapshot()
            : Promise.resolve({
                supported: false,
                enabled: false,
                target: "web",
                detail: "Native app required",
              }),
        ]);
        const normalizedSettings = settingsWithLaunchOnLoginSnapshot(settings, launchOnLogin);
        applySettingsSideEffects(normalizedSettings.document, false);
        set({
          settings: normalizedSettings,
          launchOnLogin,
          openWithAssociations,
          shortcuts,
        });
        if (normalizedSettings !== settings) {
          void saveLocalDocument(normalizedSettings.document).catch(() => undefined);
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

  applyProfileValues: async (values, valid = () => true) => {
    const apply = async () => {
      if (!valid()) return;
      const current = get().settings;
      const document = projectPreferences(current?.document ?? {}, values);
      const saved = await saveLocalDocument(document);
      if (!valid()) return;
      applySettingsSideEffects(saved.document);
      set({ settings: saved });
    };
    settingsWriteQueue = settingsWriteQueue.catch(() => {}).then(apply);
    await settingsWriteQueue;
  },

  updateSetting: (section, key, value) => {
    const definition = definitionForLegacy(section, key);
    if (definition?.owner === "profile") {
      const converted =
        definition.legacyValues && typeof value === "number"
          ? definition.legacyValues[value]
          : value;
      if (!validPreference(definition, converted)) {
        set({ error: `Invalid value for ${definition.label}` });
        return;
      }
      void writeProfilePreference(definition.id, converted).catch((error) =>
        set({ error: errorText(error) }),
      );
      return;
    }
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
        (settingsWriteQueue = settingsWriteQueue
          .catch(() => {})
          .then(() => {
            const latest = cloneDocument(get().settings?.document ?? document);
            latest[section] = {
              ...((latest[section] as Record<string, unknown>) ?? {}),
              [key]: value,
            };
            return saveLocalDocument(latest);
          })).then((settings) => ({ settings: settings as SettingsSnapshot, launchOnLogin })),
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
        openWithAssociations: hasTauriInternals() ? await settingsOpenWithAssociations() : [],
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

function applySettingsSideEffects(
  document: Record<string, unknown>,
  applyPortableLayout = true,
): void {
  const appearance = document.appearance as Record<string, unknown> | undefined;
  if (applyPortableLayout && typeof appearance?.navigator_auto_hide === "boolean") {
    const layout = readNavigatorLayout();
    const visibility = appearance.navigator_auto_hide ? "hidden" : "sticky";
    if (layout.visibility !== visibility) publishNavigatorLayout({ ...layout, visibility });
  }
  telemetryPreferencesChanged(
    settingsBoolean(document, "privacy", "anonymous_usage_analytics_enabled", false),
    settingsBoolean(document, "privacy", "anonymous_error_reporting_enabled", false),
  );
  configurePageRestore({
    enabled: settingsBoolean(document, "privacy", "page_state_restore", true),
    agent: settingsBoolean(document, "privacy", "page_state_agent_restore", true),
    excludedSites: settingsString(document, "privacy", "page_state_excluded_sites", ""),
  });
  configureTabHistoryBudget(settingsNumber(document, "general", "browser_tab_history_kb", 256));
  configureBrowserHomeUrl(settingsString(document, "general", "browser_homepage", ""));
  // The document stores the engine's legacy index; the registry resolves the id.
  configureBrowserSearchEngine(String(runtimeAdapters.get("browser.searchEngine")!.read(document)));
  configureBrowserSearchSuggestions(
    settingsBoolean(document, "general", "browser_search_suggestions", false),
  );
  configureWorkspaceDefaultTab(
    settingsNumber(document, "general", "workspace_default_tab_index", 0),
  );
  setBrowserStatusBubbleEnabled(
    settingsBoolean(document, "general", "browser_status_bubble", true),
  );
  setBrowserDownloadDirectory(
    settingsString(document, "general", "browser_download_directory", ""),
  );
  setBrowserDownloadPrompt(settingsBoolean(document, "general", "browser_download_prompt", false));
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
  applyProfileValues: (values: PreferenceValues, valid?: () => boolean) => Promise<void>;
  updateSetting: (section: string, key: string, value: SettingValue) => void;
  removeOpenWithAssociation: (key: string) => Promise<void>;
  updateShortcut: (request: UpdateShortcutRequest) => Promise<void>;
  reassignShortcut: (request: ReassignShortcutRequest) => Promise<void>;
  resetShortcuts: (request?: ResetShortcutRequest) => Promise<void>;
}
