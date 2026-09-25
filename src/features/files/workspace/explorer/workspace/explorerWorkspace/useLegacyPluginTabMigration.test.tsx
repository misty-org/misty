import { renderHook } from "@testing-library/react";
import { createMultiPanelStore } from "@/features/workspace";
import { describe, expect, it } from "vitest";
import { useLegacyPluginTabMigration } from "./useExplorerWorkspaceEvents";

describe("retired extension tab recovery", () => {
  it("restores legacy tabs to Files without changing ordinary tabs or focus", () => {
    const store = createMultiPanelStore({ idPrefix: "retired-extension" });
    store.getState().initialize("/Users/test/Documents", "Documents");
    const browseId = store.getState().activeTabId;
    store.getState().addTab("misty-plugin://panel?plugin=themes&panel=main", "Themes");
    const legacy = store.getState().tabs.find((tab) => tab.id !== browseId)!;
    store
      .getState()
      .setTabPanelVisibility(legacy.id, { sidebarVisible: false, previewVisible: false });
    store.getState().selectTab(browseId);

    renderHook(() =>
      useLegacyPluginTabMigration({
        homePath: "/Users/test",
        workspacePathSignature: "saved-tabs",
        multiPanelStore: store,
      }),
    );

    expect(store.getState().activeTabId).toBe(browseId);
    expect(store.getState().tabs.find((tab) => tab.id === browseId)?.path).toBe(
      "/Users/test/Documents",
    );
    expect(store.getState().tabs.find((tab) => tab.id === legacy.id)).toMatchObject({
      path: "/Users/test",
      title: "Files",
      sidebarVisible: true,
      previewVisible: true,
    });
  });

  it("waits until the home folder is available", () => {
    const store = createMultiPanelStore({ idPrefix: "retired-extension-wait" });
    const path = "misty-plugin://commands?plugin=quick_convert";
    store.getState().initialize(path, "Convert");
    const { rerender } = renderHook(
      ({ homePath }) =>
        useLegacyPluginTabMigration({
          homePath,
          workspacePathSignature: path,
          multiPanelStore: store,
        }),
      { initialProps: { homePath: "" } },
    );
    expect(store.getState().tabs[0].path).toBe(path);
    rerender({ homePath: "/Users/test" });
    expect(store.getState().tabs[0].path).toBe("/Users/test");
  });
});
