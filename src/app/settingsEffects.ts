import {
  normalizeDockingLayout,
  useDockingLayoutStore,
  validDockingLayout,
  type SavedDockingLayout,
  type StoredDockingLayout,
} from "@/app/shell/dockingLayout";
import { configureStartupPreference } from "@/app/shell";
import { configureWorkspaceDefaultView } from "@/features/app-windows";
import { workspaceDefaultViewIndex } from "@/features/settings";
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
  configureLinkPreviews(settingsBoolean(document, "general", "browser_link_previews", true));
  configureWorkspaceDefaultView(
    settingsNumber(document, "general", "workspace_default_tab_index", workspaceDefaultViewIndex),
  );
  // Mirrored to localStorage: the index route redirects before this document
  // has loaded, so it cannot read the preference from here directly.
  configureStartupPreference({
    reopenLastSession: settingsBoolean(document, "general", "reopen_last_session", true),
    startupViewIndex: settingsNumber(document, "general", "startup_view_index", 0),
  });
}

onSettingsApplied(applyFeatureSettings);
