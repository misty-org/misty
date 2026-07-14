import { describe, expect, it } from "vitest";
import type { PluginCommandEntry, PluginPanelEntry } from "../../../api/types";
import { parsePluginTabPath, pluginMenuItems } from "./ExplorerDesktopPlugins";

const panel: PluginPanelEntry = {
  id: "main",
  title: "Quick Convert",
  pluginId: "quick_convert",
  pluginName: "Quick Convert",
  windowType: "panel",
  defaultWidth: 560,
  defaultHeight: 620,
  pluginDir: "/extensions/quick_convert",
  manifestPath: "/extensions/quick_convert/manifest.json",
  libraryPath: "",
  webEntry: "web/index.html?plugin=quick_convert",
  launcherViews: ["files"],
};

const command: PluginCommandEntry = {
  id: "quick_convert.run",
  label: "Convert selection",
  hint: "Convert the selected file",
  pluginId: "quick_convert",
  pluginName: "Quick Convert",
  defaultShortcut: "",
  source: "action",
  actionKind: "primary",
  launcherOpenMode: "popup",
  requiresSelectedFile: true,
  pluginDir: "/extensions/quick_convert",
  manifestPath: "/extensions/quick_convert/manifest.json",
  libraryPath: "",
};

describe("extension popup routing", () => {
  it("groups panels and commands for a selected file", () => {
    const [plugin] = pluginMenuItems([panel], [command], "/tmp/movie.mov");
    expect(plugin.pluginId).toBe("quick_convert");
    expect(plugin.usable).toBe(true);
    expect(plugin.panels).toHaveLength(1);
    expect(plugin.commands).toHaveLength(1);
  });

  it("retains legacy tab parsing for migration", () => {
    expect(parsePluginTabPath("misty-plugin://panel?plugin=themes&panel=main&selected=%2Ftmp%2Fa.png"))
      .toEqual({ kind: "panel", pluginId: "themes", panelId: "main", selectedPath: "/tmp/a.png" });
    expect(parsePluginTabPath("/files?extension=themes")).toBeNull();
  });
});
