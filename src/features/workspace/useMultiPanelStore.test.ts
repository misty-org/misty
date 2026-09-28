import { describe, expect, it } from "vitest";
import {
  createMultiPanelStore,
  destroyMultiPanelStore,
  multiPanelStoreForPane,
} from "./useMultiPanelStore";

describe("multi-panel workspace state", () => {
  it("restores the focused folder from a legacy split layout", () => {
    const source = createMultiPanelStore({ idPrefix: "source" });
    source.getState().initialize("/Users/demo", "demo");
    const tab = source.getState().tabs[0];
    const focused = { id: "legacy-second", path: "/Users/demo/Documents", title: "Documents" };
    source.setState({
      tabs: [
        {
          ...tab,
          panes: [...tab.panes, focused],
          activePaneId: focused.id,
          layout: {
            orientation: "vertical",
            paneIds: [tab.activePaneId, focused.id],
            lanes: [[tab.activePaneId], [focused.id]],
          },
        },
      ],
      activePaneId: focused.id,
    });
    const snapshot = source.getState();
    const restored = createMultiPanelStore({ idPrefix: "restored" });

    expect(restored.getState().hydrate(snapshot)).toBe(true);
    expect(restored.getState().tabs[0]?.panes).toHaveLength(1);
    expect(restored.getState().tabs[0]?.layout.lanes).toHaveLength(1);

    expect(restored.getState().tabs[0]?.path).toBe("/Users/demo/Documents");
    expect(restored.getState().activePaneId).toBe("legacy-second");
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
