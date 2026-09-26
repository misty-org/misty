import { createMultiPanelStore, dockTabs, useWorkspaceStore } from "@/features/workspace";
import { beforeEach, describe, expect, it } from "vitest";
import {
  canCloseExplorerTab,
  ensureFilesBrowseTab,
  isTransfersTabPath,
  openTransfersTab,
  parsePluginTabPath,
  returnToBrowseTab,
} from "./ExplorerDesktopPlugins";

describe("retired extension tabs", () => {
  it("recognizes saved plugin paths for recovery", () => {
    expect(
      parsePluginTabPath("misty-plugin://panel?plugin=themes&panel=main&selected=%2Ftmp%2Fa.png"),
    ).toEqual({ kind: "panel", pluginId: "themes", panelId: "main", selectedPath: "/tmp/a.png" });
    expect(parsePluginTabPath("/Users/test")).toBeNull();
  });
});

describe("Files special tabs", () => {
  it("repairs a workspace restored with only the Transfers tab", () => {
    const store = createMultiPanelStore({ idPrefix: "files-test" });
    store.getState().initialize("misty-transfers://history", "Transfers");

    expect(ensureFilesBrowseTab("/Users/test", store)).toBe(true);
    expect(store.getState().tabs.some((tab) => tab.path === "/Users/test")).toBe(true);
    expect(isTransfersTabPath(store.getState().tabs[0]?.path ?? "")).toBe(true);
  });

  it("keeps the final browse tab while allowing special tabs to close", () => {
    const store = createMultiPanelStore({ idPrefix: "files-test" });
    store.getState().initialize("/Users/test", "Home");
    store.getState().addTab("misty-transfers://history", "Transfers");
    const tabs = store.getState().tabs;
    const browseTab = tabs.find((tab) => tab.path === "/Users/test");
    const transfersTab = tabs.find((tab) => isTransfersTabPath(tab.path));

    expect(browseTab && canCloseExplorerTab(browseTab, tabs)).toBe(false);
    expect(transfersTab && canCloseExplorerTab(transfersTab, tabs)).toBe(true);
  });
});

describe("Transfers workspace", () => {
  beforeEach(() => {
    useWorkspaceStore.persist.clearStorage();
    useWorkspaceStore.getState().reset();
  });

  it("opens Transfers as its own workspace tool", () => {
    const tab = openTransfersTab();
    expect(tab).toMatchObject({
      surfaceId: "transfers",
      groupKey: "tool:transfers",
      route: "/transfers",
    });
  });

  it("reselects the existing tool instead of stacking duplicates", () => {
    const first = openTransfersTab();
    const second = openTransfersTab();
    const tabs = dockTabs(useWorkspaceStore.getState().layout.root);
    expect(tabs.filter((tab) => tab.surfaceId === "transfers")).toHaveLength(1);
    expect(second.id).toBe(first.id);
  });
});

describe("leaving a chrome tab", () => {
  it("returns to the existing browse tab", () => {
    const store = createMultiPanelStore({ idPrefix: "files-test" });
    store.getState().initialize("/Users/test", "Home");
    const browseTabId = store.getState().activeTabId;
    store.getState().addTab("misty-transfers://history", "Transfers");
    expect(store.getState().activeTabId).not.toBe(browseTabId);

    returnToBrowseTab("/Users/test", store);

    expect(store.getState().activeTabId).toBe(browseTabId);
  });

  it("opens a browse tab when only chrome tabs remain", () => {
    const store = createMultiPanelStore({ idPrefix: "files-test" });
    store.getState().initialize("misty-transfers://history", "Transfers");

    returnToBrowseTab("/Users/test/Documents", store);

    const active = store.getState().tabs.find((tab) => tab.id === store.getState().activeTabId);
    expect(active?.path).toBe("/Users/test/Documents");
    expect(active?.title).toBe("Documents");
  });
});
