import { describe, expect, it } from "vitest";
import { createMultiPanelStore } from "@/features/workspace";
import { transfersPath } from "../../../transfers/transferModel";
import {
  renderExplorerBottomBar,
  resolveExplorerBottomBarRenderer,
} from "./ExplorerWorkspaceChrome";

describe("Explorer workspace chrome", () => {
  it("keeps Files panel controls when the host owns the tabs", () => {
    expect(resolveExplorerBottomBarRenderer(true)).toBe(renderExplorerBottomBar);
  });

  it("omits folder panel controls from Transfers even with saved panels enabled", () => {
    const store = createMultiPanelStore({ idPrefix: "transfers-chrome" });
    store.getState().initialize(transfersPath, "Transfers");
    const tab = store.getState().tabs[0];
    expect(
      renderExplorerBottomBar({ ...tab, sidebarVisible: true, previewVisible: true }),
    ).toBeNull();
  });

  it("keeps the bottom bar in standalone mode", () => {
    expect(resolveExplorerBottomBarRenderer(false)).toBe(renderExplorerBottomBar);
    expect(resolveExplorerBottomBarRenderer()).toBe(renderExplorerBottomBar);
  });
});
