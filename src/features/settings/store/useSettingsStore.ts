import {
  useDockingLayoutStore,
  validDockingLayout,
  type SavedDockingLayout,
} from "@/features/app-shell/dockingLayout";
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
import {
  publishNavigatorLayout,
  readNavigatorLayout,
  configureStartupPreference,
} from "@/features/app-shell";
import { configureBrowserHomeUrl } from "@/features/workspace/browserHome";
import {
  configureBrowserCustomBangs,
  configureBrowserCustomSearchEngine,
  configureBrowserSearchEngine,
  configureBrowserSearchSuggestions,
} from "@/features/workspace/browserSearchEngine";
import {
  configureWorkspaceDefaultView,
  workspaceDefaultViewIndex,
} from "@/features/workspace/workspaceDefaultView";
import {
  setBrowserDownloadDirectory,
  setBrowserDownloadPrompt,
  setBrowserStatusBubbleEnabled,
} from "@/features/webviews/browserRuntime";
import { configureBrowserSiteZoom } from "@/features/webviews/siteZoom";
import { configureBrowserSiteStyles } from "@/features/webviews/siteStyles";
import { configureBrowserMouseGestures } from "@/features/webviews/mouseGestures";
import { applyAccentColor } from "./accentColor";
import { configureBrowserTabSleep } from "@/features/webviews/tabSleepSettings";
import { configureTabArchive } from "@/features/workspace/tabArchiveSettings";
import { configureExternalLinks } from "@/features/workspace/externalLinkSettings";
import { configureBrowserContentBlocking } from "@/features/webviews/contentBlocking";
import { configureAutoPictureInPicture } from "@/features/webviews/pictureInPictureSettings";
import { telemetryPreferencesChanged } from "@/telemetry/lifecycle";
import { errorText } from "@/shared/lib/format";
import { create } from "zustand";
import type { SettingsSection, SettingValue } from "../types/store";
import { settingsBoolean, settingsNumber, settingsString } from "./preferences";
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
  previewProfileValues: (values) => {
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

  applyProfileValues: async (values, valid = () => true) => {
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
      void writeProfilePreference(definition.id, converted).catch((error) =>
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
      await writeProfilePreference("app.shortcuts.bindings", JSON.stringify(overrides));
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
      await writeProfilePreference("app.shortcuts.bindings", JSON.stringify(overrides));
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
      await writeProfilePreference("app.shortcuts.bindings", JSON.stringify(overrides));
    } catch (error) {
      set({ error: errorText(error) });
    }
  },
}));

function currentShortcutOverrides(
  document: Record<string, unknown> | undefined,
  snapshot: ShortcutsSnapshot | null,
): ShortcutsSnapshot["overrides"] {
  const raw = (document?.shortcuts as Record<string, unknown> | undefined)?.overrides_json;
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : (snapshot?.overrides ?? []);
    return Array.isArray(value) ? structuredClone(value) : [];
  } catch {
    return [];
  }
}

function applySettingsSideEffects(
  document: Record<string, unknown>,
  applyPortableLayout = true,
): void {
  const presets = settingsString(document, "appearance", "saved_layouts_json", "[]");
  try {
    const parsed: unknown = JSON.parse(presets);
    if (applyPortableLayout && Array.isArray(parsed))
      useDockingLayoutStore.setState({
        savedLayouts: parsed.filter(
          (item): item is SavedDockingLayout =>
            validDockingLayout(item) &&
            "id" in item &&
            typeof item.id === "string" &&
            "name" in item &&
            typeof item.name === "string",
        ),
      });
  } catch {
    /* Invalid legacy data uses the last applied presets. */
  }
  const appearance = document.appearance as Record<string, unknown> | undefined;
  if (applyPortableLayout && typeof appearance?.navigator_auto_hide === "boolean") {
    const layout = readNavigatorLayout();
    const autoHide = appearance.navigator_auto_hide;
    if (layout.autoHide !== autoHide) publishNavigatorLayout({ autoHide });
  }
  applyAccentColor(settingsString(document, "appearance", "accent_color", ""));
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
  configureBrowserCustomBangs(
    settingsString(document, "general", "browser_custom_bangs_json", "[]"),
  );
  configureBrowserCustomSearchEngine(
    settingsString(document, "general", "browser_custom_search_engine", ""),
  );
  configureBrowserSiteZoom(settingsString(document, "general", "browser_site_zoom_json", "[]"));
  configureBrowserSiteStyles(settingsString(document, "general", "browser_site_styles_json", "[]"));
  configureBrowserMouseGestures(
    settingsBoolean(document, "general", "browser_mouse_gestures", false),
  );
  configureBrowserTabSleep(settingsNumber(document, "general", "browser_tab_sleep_minutes", 30));
  configureTabArchive(settingsNumber(document, "general", "browser_auto_archive_hours", 0));
  configureExternalLinks(settingsString(document, "general", "browser_external_links", "tab"));
  configureBrowserContentBlocking(
    settingsBoolean(document, "general", "browser_content_blocking", true),
    settingsString(document, "general", "browser_content_blocking_allowed_json", "[]"),
  );
  configureAutoPictureInPicture(
    settingsBoolean(document, "general", "browser_auto_picture_in_picture", true),
  );
  configureWorkspaceDefaultView(
    settingsNumber(document, "general", "workspace_default_tab_index", workspaceDefaultViewIndex),
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
  shortcuts: ShortcutsSnapshot | null;
  loaded: boolean;
  working: boolean;
  error: string | null;
  message: string | null;
  setActiveSection: (section: SettingsSection) => void;
  load: () => Promise<void>;
  previewProfileValues: (values: PreferenceValues) => void;
  applyProfileValues: (values: PreferenceValues, valid?: () => boolean) => Promise<void>;
  updateSetting: (section: string, key: string, value: SettingValue) => void;
  updateShortcut: (request: UpdateShortcutRequest) => Promise<void>;
  reassignShortcut: (request: ReassignShortcutRequest) => Promise<void>;
  resetShortcuts: (request?: ResetShortcutRequest) => Promise<void>;
}
