import {
  normalizeDockingLayout,
  useDockingLayoutStore,
  validDockingLayout,
  type SavedDockingLayout,
  type StoredDockingLayout,
} from "@/app/shell/dockingLayout";
import { configureTabHistoryBudget } from "@/features/browser";
import { configureStartupPreference } from "@/app/shell";
import { configureBrowserHomeUrl } from "@/features/app-windows";
import { configureBrowserSearchSuggestions } from "@/features/app-windows";
import { configureDeviceBangs } from "@/features/app-windows";
import { configureWorkspaceDefaultView } from "@/features/app-windows";
import { workspaceDefaultViewIndex } from "@/features/settings";
import {
  setBrowserDownloadDirectory,
  setBrowserDownloadPrompt,
  setBrowserStatusBubbleEnabled,
} from "@/features/app-windows";
import { configureBrowserSiteZoom } from "@/features/browser";
import { configureBrowserSiteStyles } from "@/features/browser";
import { configureHiddenTabSleep } from "@/features/browser";
import { configureTabArchive } from "@/features/app-windows";
import { configureLinkPreviews } from "@/features/files";
import {
  onSettingsApplied,
  settingsBoolean,
  settingsNumber,
  settingsString,
} from "@/features/settings";

// Where each preference reaches the feature that acts on it.
function applyFeatureSettings(
  document: Record<string, unknown>,
  applyPortableLayout: boolean,
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
  configureTabHistoryBudget(settingsNumber(document, "general", "browser_tab_history_kb", 256));
  configureBrowserHomeUrl(settingsString(document, "general", "browser_homepage", ""));
  configureBrowserSearchSuggestions(
    settingsBoolean(document, "general", "browser_search_suggestions", false),
  );
  // Bangs are the profile's; this computer's own list applies while those can't be read.
  configureDeviceBangs(settingsString(document, "general", "browser_custom_bangs_json", "[]"));
  configureBrowserSiteZoom(settingsString(document, "general", "browser_site_zoom_json", "[]"));
  configureBrowserSiteStyles(settingsString(document, "general", "browser_site_styles_json", "[]"));
  configureTabArchive(settingsNumber(document, "general", "browser_auto_archive_hours", 0));
  configureHiddenTabSleep(
    settingsNumber(document, "general", "browser_hidden_tab_sleep_seconds", 0),
  );
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

onSettingsApplied(applyFeatureSettings);
