import type { PluginPanelEntry } from "@/native/contracts";
import { describe, expect, it } from "vitest";
import { installedAppsFromPanels } from "./useInstalledApps";

function panel(pluginId: string, pluginName: string, id: string): PluginPanelEntry {
  return {
    id,
    title: pluginName,
    pluginId,
    pluginName,
    windowType: "panel",
    defaultWidth: 560,
    defaultHeight: 420,
    pluginDir: `/extensions/${pluginId}`,
    manifestPath: `/extensions/${pluginId}/manifest.json`,
    libraryPath: "",
    webEntry: "web/index.html",
    launcherViews: ["all"],
  };
}

describe("installed apps", () => {
  it("lists each enabled package once even when it exposes multiple panels", () => {
    expect(
      installedAppsFromPanels([
        panel("themes", "Themes", "themes.main"),
        panel("backups", "Backups", "backups.main"),
        panel("themes", "Themes", "themes.preview"),
      ]),
    ).toEqual([
      { id: "backups", name: "Backups" },
      { id: "themes", name: "Themes" },
    ]);
  });
});
