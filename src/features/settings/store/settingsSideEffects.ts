import {
  normalizeDockingLayout,
  useDockingLayoutStore,
  validDockingLayout,
  type SavedDockingLayout,
  type StoredDockingLayout,
} from "@/features/app-shell/dockingLayout";
import { configureTabHistoryBudget } from "@/features/webviews/tabHistory";
import { configurePageRestore } from "@/features/browser-sync/pageRestoreSettings";
import type { ShortcutsSnapshot } from "@/native/ipc";
import { configureStartupPreference } from "@/features/app-shell";
import { configureBrowserHomeUrl } from "@/features/workspace/browserHome";
import { configureBrowserSearchSuggestions } from "@/features/workspace/browserSearchEngine";
import { configureDeviceBangs } from "@/features/workspace/spaceSearch";
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
import { configureHiddenTabSleep } from "@/features/webviews/hiddenTabSleep";
import { configureTabArchive } from "@/features/workspace/tabArchiveSettings";
import { configureExternalLinks } from "@/features/workspace/externalLinkSettings";
import { telemetryPreferencesChanged } from "@/telemetry/lifecycle";
import { invoke } from "@/native/invoke";
import { configureLinkPreviews } from "@/features/link-preview/settings";
import { settingsBoolean, settingsNumber, settingsString } from "./preferences";

// What the settings store (useSettingsStore.ts) applies outside itself when a document loads or changes.

export function currentShortcutOverrides(
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

export function applySettingsSideEffects(
  document: Record<string, unknown>,
  applyPortableLayout = true,
): void {
  const presets = settingsString(document, "appearance", "saved_layouts_json", "[]");
  try {
    const parsed: unknown = JSON.parse(presets);
    if (applyPortableLayout && Array.isArray(parsed))
      useDockingLayoutStore.setState({
        savedLayouts: parsed
          .filter(
            (item): item is StoredDockingLayout & Pick<SavedDockingLayout, "id" | "name"> =>
              validDockingLayout(item) &&
              "id" in item &&
              typeof item.id === "string" &&
              "name" in item &&
              typeof item.name === "string",
          )
          .map((item): SavedDockingLayout => ({ ...item, ...normalizeDockingLayout(item) })),
      });
  } catch {
    /* Invalid legacy data uses the last applied presets. */
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
  // This device's own sync frequency: the native sync worker scales its send timings by it.
  void invoke("browser_sync_set_frequency", {
    frequency: settingsString(document, "sync", "sync_frequency", "balanced"),
  }).catch(() => undefined);
  configureBrowserHomeUrl(settingsString(document, "general", "browser_homepage", ""));
  configureBrowserSearchSuggestions(
    settingsBoolean(document, "general", "browser_search_suggestions", false),
  );
  // Bangs are Space data; the device's own list applies while no Space vault is open.
  configureDeviceBangs(settingsString(document, "general", "browser_custom_bangs_json", "[]"));
  configureBrowserSiteZoom(settingsString(document, "general", "browser_site_zoom_json", "[]"));
  configureBrowserSiteStyles(settingsString(document, "general", "browser_site_styles_json", "[]"));
  configureBrowserMouseGestures(
    settingsBoolean(document, "general", "browser_mouse_gestures", false),
  );
  configureTabArchive(settingsNumber(document, "general", "browser_auto_archive_hours", 0));
  configureHiddenTabSleep(
    settingsNumber(document, "general", "browser_hidden_tab_sleep_seconds", 0),
  );
  configureExternalLinks(settingsString(document, "general", "browser_external_links", "tab"));
  configureLinkPreviews(settingsBoolean(document, "general", "browser_link_previews", true));
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
