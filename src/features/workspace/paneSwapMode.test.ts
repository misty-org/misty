import { expect, it } from "vitest";
import { paneInDirection } from "./paneSwapMode";

// Four panes in a 2 x 2 grid:  a b
//                              c d
const grid = [
  { id: "a", left: 0, top: 0, right: 100, bottom: 100 },
  { id: "b", left: 100, top: 0, right: 200, bottom: 100 },
  { id: "c", left: 0, top: 100, right: 100, bottom: 200 },
  { id: "d", left: 100, top: 100, right: 200, bottom: 200 },
];

it("moves to the neighbour in each direction", () => {
  expect(paneInDirection(grid, "a", "right")).toBe("b");
  expect(paneInDirection(grid, "a", "down")).toBe("c");
  expect(paneInDirection(grid, "d", "left")).toBe("c");
  expect(paneInDirection(grid, "d", "up")).toBe("b");
});

it("stays put at an edge", () => {
  expect(paneInDirection(grid, "a", "left")).toBeNull();
  expect(paneInDirection(grid, "a", "up")).toBeNull();
  expect(paneInDirection(grid, "d", "right")).toBeNull();
});

it("prefers a pane lined up with the current one over a nearer pane off to the side", () => {
  const panes = [
    { id: "left", left: 0, top: 0, right: 100, bottom: 200 },
    { id: "top-right", left: 100, top: 0, right: 200, bottom: 100 },
    { id: "bottom-right", left: 100, top: 100, right: 200, bottom: 200 },
  ];
  expect(paneInDirection(panes, "top-right", "down")).toBe("bottom-right");
  expect(paneInDirection(panes, "bottom-right", "left")).toBe("left");
});

it("returns null for an unknown pane", () => {
  expect(paneInDirection(grid, "missing", "right")).toBeNull();
});
