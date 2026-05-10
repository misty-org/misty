import { describe, expect, it } from "vitest";
import { paneIdInDirection, type PaneBounds } from "./paneNavigation";

const panes: PaneBounds[] = [
  { id: "top-left", left: 0, top: 0, width: 100, height: 100 },
  { id: "top-right", left: 100, top: 0, width: 100, height: 100 },
  { id: "bottom-left", left: 0, top: 100, width: 100, height: 100 },
  { id: "bottom-right", left: 100, top: 100, width: 100, height: 100 },
];

describe("paneIdInDirection", () => {
  it("uses the nearest pane in each spatial direction", () => {
    expect(paneIdInDirection("bottom-right", "left", panes)).toBe("bottom-left");
    expect(paneIdInDirection("bottom-right", "up", panes)).toBe("top-right");
    expect(paneIdInDirection("top-left", "right", panes)).toBe("top-right");
    expect(paneIdInDirection("top-left", "down", panes)).toBe("bottom-left");
  });

  it("stops at an outer edge instead of wrapping", () => {
    expect(paneIdInDirection("top-left", "left", panes)).toBeNull();
    expect(paneIdInDirection("bottom-right", "down", panes)).toBeNull();
  });
});
