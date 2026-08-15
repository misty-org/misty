import { describe, expect, it } from "vitest";
import type { LocalPluginRecord } from "./model/types";
import { buildPluginViews } from "./store/pluginCatalogState";

describe("extension catalog state", () => {
  it("keeps installed extensions visible when the marketplace is unavailable", () => {
    const local = localPlugin();

    const views = buildPluginViews([], "", [local], "macos-aarch64");

    expect(views.marketplacePlugins).toEqual([]);
    expect(views.installedPlugins).toEqual([
      expect.objectContaining({
        id: local.id,
        name: local.name,
        installed: true,
        enabled: true,
      }),
    ]);
  });
});

function localPlugin(): LocalPluginRecord {
  return {
    id: "themes",
    name: "Themes",
    version: "1.0.0",
    author: "Misty",
    overview: "Customize Misty.",
    status: "installed",
    root: "public",
    enabled: true,
    installed: true,
    verified: true,
    manifest_path: "/plugins/themes/plugin.json",
    plugin_dir: "/plugins/themes",
    capabilities: ["Themes"],
    where_it_appears: ["Settings"],
    permissions: [],
    getting_started: [],
    changelog: [],
    included_tools: [],
    links: [],
    actions: [],
    launcher: {
      views: [],
      show_in_launcher: false,
      requires_selected_file: false,
      open_mode: "popup",
    },
  };
}
