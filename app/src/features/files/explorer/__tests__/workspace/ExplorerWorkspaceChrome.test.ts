import { describe, expect, it } from "vitest";
import {
  renderExplorerBottomBar,
  resolveExplorerBottomBarRenderer,
} from "../../workspace/ExplorerWorkspaceChrome";

describe("Explorer workspace chrome", () => {
  it("leaves the bottom bar to the host when embedded", () => {
    expect(resolveExplorerBottomBarRenderer(true)).toBeUndefined();
  });

  it("keeps the bottom bar in standalone mode", () => {
    expect(resolveExplorerBottomBarRenderer(false)).toBe(renderExplorerBottomBar);
    expect(resolveExplorerBottomBarRenderer()).toBe(renderExplorerBottomBar);
  });
});
