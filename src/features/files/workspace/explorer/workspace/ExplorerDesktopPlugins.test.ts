import { createMultiPanelStore } from "@/features/workspace";
import { describe, expect, it } from "vitest";
import { canCloseExplorerTab, parsePluginTabPath } from "./ExplorerDesktopPlugins";

describe("retired extension tabs", () => {
  it("recognizes saved plugin paths for recovery", () => {
    expect(
      parsePluginTabPath("misty-plugin://panel?plugin=themes&panel=main&selected=%2Ftmp%2Fa.png"),
    ).toEqual({ kind: "panel", pluginId: "themes", panelId: "main", selectedPath: "/tmp/a.png" });
    expect(parsePluginTabPath("/Users/test")).toBeNull();
  });
});

describe("Files tabs", () => {
  it("keeps the last folder tab open", () => {
    const store = createMultiPanelStore();
    store.getState().initialize("/Users/test", "Home");
    const first = store.getState().tabs[0];
    expect(canCloseExplorerTab(first, store.getState().tabs)).toBe(false);
    store.getState().addTab("/Users/test/Documents", "Documents");
    expect(canCloseExplorerTab(first, store.getState().tabs)).toBe(true);
  });
});
