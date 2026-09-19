import { describe, expect, it } from "vitest";
import {
  renderExplorerBottomBar,
  resolveExplorerBottomBarRenderer,
} from "../workspace/ExplorerWorkspaceChrome";

describe("Explorer workspace chrome", () => {
  it("keeps Files panel controls when the host owns the tabs", () => {
    expect(resolveExplorerBottomBarRenderer(true)).toBe(renderExplorerBottomBar);
  });

  it("keeps the bottom bar in standalone mode", () => {
    expect(resolveExplorerBottomBarRenderer(false)).toBe(renderExplorerBottomBar);
    expect(resolveExplorerBottomBarRenderer()).toBe(renderExplorerBottomBar);
  });
});
