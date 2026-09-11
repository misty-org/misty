import { describe, expect, it } from "vitest";
import { createDockLeaf, dockLeaves, insertDockSplit, moveDockPane } from "./dockTree";

describe("whole pane arrangement", () => {
  const a = createDockLeaf(),
    b = createDockLeaf(),
    c = createDockLeaf(),
    d = createDockLeaf();
  const root = insertDockSplit(
    insertDockSplit(insertDockSplit(a, a.id, b, "right"), b.id, c, "down"),
    a.id,
    d,
    "down",
  );
  it.each(["left", "right", "up", "down"] as const)(
    "moves a pane to %s while retaining all four identities",
    (direction) => {
      const moved = moveDockPane(root, a.id, direction);
      expect(
        dockLeaves(moved)
          .map((p) => p.id)
          .sort(),
      ).toEqual([a.id, b.id, c.id, d.id].sort());
      expect(moved.type).toBe("split");
      if (moved.type !== "split") throw new Error("Expected split");
      expect(moved.direction).toBe("horizontal");
      expect(moved.first.type).toBe("split");
      expect(moved.second.type).toBe("split");
    },
  );
  it("inserts next to a target without duplicating the source or dropping its sibling", () => {
    const moved = moveDockPane(root, a.id, "up", c.id);
    expect(dockLeaves(moved)).toHaveLength(4);
    expect(dockLeaves(moved).map((pane) => pane.id)).toEqual([a.id, d.id, b.id, c.id]);
    expect(dockLeaves(moved)[0].tabs).toBe(c.tabs);
    expect(dockLeaves(moved)[3].tabs).toBe(a.tabs);
    expect(dockLeaves(root)).toEqual([a, d, b, c]);
  });
  it("ignores self, missing targets and the sole pane", () => {
    expect(moveDockPane(root, a.id, "right", a.id)).toBe(root);
    expect(moveDockPane(root, a.id, "right", "missing")).toBe(root);
    expect(moveDockPane(a, a.id, "down")).toBe(a);
  });
});

it("previews the final two-pane slot, not half of the existing target", async () => {
  const { dockPaneBounds } = await import("./dockTree");
  const left = createDockLeaf(),
    right = createDockLeaf();
  const root = insertDockSplit(left, left.id, right, "right");
  const next = moveDockPane(root, right.id, "right", left.id);
  expect(dockPaneBounds(next, right.id, { x: 0, y: 0, width: 1000, height: 800 })).toEqual({
    x: 500,
    y: 0,
    width: 500,
    height: 800,
  });
  const stacked = moveDockPane(root, right.id, "down", left.id);
  expect(dockPaneBounds(stacked, right.id, { x: 0, y: 0, width: 1000, height: 800 })).toEqual({
    x: 0,
    y: 400,
    width: 1000,
    height: 400,
  });
});

it("points close toward the immediate sibling in nested layouts", async () => {
  const { dockPaneCloseDirection } = await import("./dockTree");
  const a = createDockLeaf(),
    b = createDockLeaf(),
    c = createDockLeaf();
  const root = insertDockSplit(insertDockSplit(a, a.id, b, "right"), b.id, c, "down");
  expect(dockPaneCloseDirection(root, a.id)).toBe("right");
  expect(dockPaneCloseDirection(root, b.id)).toBe("down");
  expect(dockPaneCloseDirection(root, c.id)).toBe("up");
  expect(dockPaneCloseDirection(insertDockSplit(a, a.id, b, "right"), b.id)).toBe("left");
  expect(dockPaneCloseDirection(a, a.id)).toBeNull();
});
