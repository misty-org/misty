import { describe, expect, it } from "vitest";
import {
  createMultiPanelStore,
  destroyMultiPanelStore,
  multiPanelStoreForPane,
} from "./useMultiPanelStore";

describe("multi-panel workspace state", () => {
  it("preserves every valid pane when hydrating a split layout", () => {
    const source = createMultiPanelStore({ idPrefix: "source" });
    source.getState().initialize("/Users/demo", "demo");
    source.getState().splitPane(source.getState().activePaneId, "vertical");
    const snapshot = source.getState();
    const restored = createMultiPanelStore({ idPrefix: "restored" });

    expect(restored.getState().hydrate(snapshot)).toBe(true);
    expect(restored.getState().tabs[0]?.panes).toHaveLength(2);
    expect(restored.getState().tabs[0]?.layout.lanes).toHaveLength(2);

    destroyMultiPanelStore(source);
    destroyMultiPanelStore(restored);
  });

  it("releases scoped pane ownership when an outer tab closes", () => {
    const scoped = createMultiPanelStore({ idPrefix: "released" });
    scoped.getState().initialize("/Users/demo", "demo");
    const paneId = scoped.getState().activePaneId;
    expect(multiPanelStoreForPane(paneId)).toBe(scoped);

    destroyMultiPanelStore(scoped);
    expect(multiPanelStoreForPane(paneId)).not.toBe(scoped);
  });
});
