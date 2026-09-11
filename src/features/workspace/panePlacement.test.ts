import { expect, it } from "vitest";
import { createDockLeaf, dockLeaves, insertDockSplit, moveDockPane } from "./dockTree";
import { panePlacement } from "./panePlacement";
const bounds = { x: 0, y: 0, width: 1000, height: 800 };
it("offers only whole-quadrant swaps at four panes, even near an edge", () => {
  const a = createDockLeaf(),
    b = createDockLeaf(),
    c = createDockLeaf(),
    d = createDockLeaf();
  const root = insertDockSplit(
    insertDockSplit(insertDockSplit(a, a.id, b, "right"), a.id, c, "down"),
    b.id,
    d,
    "down",
  );
  for (const [x, y, target] of [
    [501, 1, b.id],
    [1, 401, c.id],
    [999, 799, d.id],
  ] as const) {
    const placement = panePlacement(root, a.id, x, y, bounds)!;
    expect(placement.zone).toBe("center");
    expect(placement.target).toBe(target);
    expect(placement.bounds.width).toBe(500);
    expect(placement.bounds.height).toBe(400);
  }
  expect(panePlacement(root, a.id, 1, 1, bounds)).toBeNull();
});
it("collapses the vacated right split before resolving three-pane targets", () => {
  const a = createDockLeaf(),
    b = createDockLeaf(),
    c = createDockLeaf();
  const root = insertDockSplit(insertDockSplit(a, a.id, b, "right"), b.id, c, "down");
  const placement = panePlacement(root, c.id, 750, 790, bounds)!;
  expect(placement.target).toBe(b.id);
  expect(placement.zone).toBe("down");
  expect(placement.bounds).toEqual({ x: 500, y: 400, width: 500, height: 400 });
  const next = moveDockPane(root, c.id, "right", b.id);
  expect(dockLeaves(next)).toHaveLength(3);
  if (next.type !== "split" || next.second.type !== "split") throw new Error("Expected 1+2");
  expect(next.direction).toBe("horizontal");
  expect(next.second.direction).toBe("vertical");
  expect(panePlacement(root, c.id, -10, 0, bounds)).toBeNull();
});

it("places a lifted pane on the indicated side even inside the former center swap region", () => {
  const a = createDockLeaf(),
    b = createDockLeaf();
  for (const orientation of ["right", "down"] as const) {
    const root = insertDockSplit(a, a.id, b, orientation);
    for (const source of [a.id, b.id]) {
      for (const [x, y, direction] of [
        [350, 400, "left"],
        [650, 400, "right"],
        [500, 280, "up"],
        [500, 520, "down"],
      ] as const) {
        const placement = panePlacement(root, source, x, y, bounds)!;
        expect(placement.zone).toBe(direction);
        const next = moveDockPane(
          root,
          source,
          placement.zone as "left" | "right" | "up" | "down",
          placement.target || undefined,
        );
        expect(next.type).toBe("split");
        if (next.type !== "split") throw new Error("Expected split");
        expect((direction === "left" || direction === "up" ? next.first : next.second).id).toBe(
          source,
        );
        expect(x).toBeGreaterThanOrEqual(placement.bounds.x);
        expect(x).toBeLessThanOrEqual(placement.bounds.x + placement.bounds.width);
        expect(y).toBeGreaterThanOrEqual(placement.bounds.y);
        expect(y).toBeLessThanOrEqual(placement.bounds.y + placement.bounds.height);
      }
    }
  }
});

it("commits a right-side drop through the real workspace store", async () => {
  const { useWorkspaceStore } = await import("./useWorkspaceStore");
  const store = useWorkspaceStore.getState();
  store.reset();
  const leftId = useWorkspaceStore.getState().layout.focusedPaneId;
  const rightId = useWorkspaceStore.getState().splitPane(leftId, "right")!;
  const root = useWorkspaceStore.getState().layout.root;
  const placement = panePlacement(root, leftId, 800, 400, bounds)!;
  useWorkspaceStore
    .getState()
    .movePane(leftId, placement.zone as "right", placement.target || undefined);
  const final = useWorkspaceStore.getState().layout.root;
  expect(final.type).toBe("split");
  if (final.type !== "split") throw new Error("Expected split");
  expect(final.first.id).toBe(rightId);
  expect(final.second.id).toBe(leftId);
});
