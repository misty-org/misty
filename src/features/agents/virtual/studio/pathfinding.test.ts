import { describe, expect, it } from "vitest";
import { GRID, cellCenter, cellOf } from "./grid";
import { defaultLayout, type StudioItem } from "./layout";
import {
  buildNavGrid,
  findPath,
  isWalkable,
  lineClear,
  nearestWalkable,
  reachable,
  routeTo,
  smoothPath,
} from "./pathfinding";

/** A wall of plants across the room at z = 5, with one gap at x = 15. */
const wall: StudioItem[] = Array.from({ length: GRID.w }, (_, x) => x)
  .filter((x) => x !== 15)
  .map((x) => ({ id: `p${x}`, kind: "plant" as const, x, z: 5, rot: 0 as const }));

describe("studio pathfinding", () => {
  it("blocks only the solid part of a piece", () => {
    const grid = buildNavGrid([{ id: "d", kind: "desk", x: 4, z: 4, rot: 0 }]);
    expect(isWalkable(grid, { x: 4, z: 4 })).toBe(false);
    expect(isWalkable(grid, { x: 4, z: 5 })).toBe(true);
    expect(isWalkable(grid, { x: -1, z: 0 })).toBe(false);
    expect(
      isWalkable(buildNavGrid([{ id: "r", kind: "rug", x: 4, z: 4, rot: 0 }]), { x: 5, z: 5 }),
    ).toBe(true);
  });

  it("walks straight across an empty floor", () => {
    const path = findPath(buildNavGrid([]), { x: 0, z: 0 }, { x: 5, z: 5 });
    expect(path).toHaveLength(6);
    expect(path?.slice(-1)[0]).toEqual({ x: 5, z: 5 });
  });

  it("goes round through the only gap and never through a blocked cell", () => {
    const grid = buildNavGrid(wall);
    const path = findPath(grid, { x: 2, z: 2 }, { x: 2, z: 9 });
    expect(path).not.toBeNull();
    expect(path!.some((cell) => cell.x === 15 && cell.z === 5)).toBe(true);
    expect(path!.every((cell) => isWalkable(grid, cell))).toBe(true);
    for (let index = 1; index < path!.length; index += 1) {
      const [a, b] = [path![index - 1]!, path![index]!];
      expect(Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z))).toBe(1);
      // A diagonal step never cuts the corner of a blocked cell.
      expect(isWalkable(grid, { x: a.x, z: b.z }) && isWalkable(grid, { x: b.x, z: a.z })).toBe(
        true,
      );
    }
  });

  it("finds no way through a closed wall or to a blocked cell", () => {
    const closed = buildNavGrid([...wall, { id: "gap", kind: "plant", x: 15, z: 5, rot: 0 }]);
    expect(findPath(closed, { x: 2, z: 2 }, { x: 2, z: 9 })).toBeNull();
    expect(findPath(closed, { x: 2, z: 2 }, { x: 3, z: 5 })).toBeNull();
  });

  it("finds the nearest free cell to a blocked one", () => {
    const grid = buildNavGrid(wall);
    expect(nearestWalkable(grid, { x: 3, z: 5 })).toMatchObject({ x: 3 });
    expect(nearestWalkable(grid, { x: 3, z: 2 })).toEqual({ x: 3, z: 2 });
    expect(nearestWalkable(grid, { x: -4, z: 40 })).toEqual({ x: 0, z: GRID.d - 1 });
    const north = reachable(grid, { x: 3, z: 2 });
    expect(nearestWalkable(grid, { x: 3, z: 6 }, north)).toEqual({ x: 3, z: 6 });
    const sealed = buildNavGrid([...wall, { id: "gap", kind: "plant", x: 15, z: 5, rot: 0 }]);
    expect(nearestWalkable(sealed, { x: 3, z: 6 }, reachable(sealed, { x: 3, z: 2 }))).toEqual({
      x: 3,
      z: 4,
    });
  });

  it("smooths a path down to its corners without crossing anything", () => {
    const grid = buildNavGrid(wall);
    const path = findPath(grid, { x: 2, z: 2 }, { x: 2, z: 9 })!;
    const smooth = smoothPath(grid, path);
    expect(smooth.length).toBeLessThan(path.length);
    expect(smooth[0]).toEqual(path[0]);
    expect(smooth.slice(-1)[0]).toEqual(path.slice(-1)[0]);
    for (let index = 1; index < smooth.length; index += 1) {
      expect(lineClear(grid, cellCenter(smooth[index - 1]!), cellCenter(smooth[index]!))).toBe(
        true,
      );
    }
    expect(lineClear(grid, cellCenter({ x: 2, z: 2 }), cellCenter({ x: 2, z: 9 }))).toBe(false);
  });

  it("routes to the exact place, even one inside a piece", () => {
    const grid = buildNavGrid(defaultLayout().items);
    const seat = { x: -11.45, z: -7.42 };
    expect(isWalkable(grid, cellOf(seat))).toBe(false);
    const route = routeTo(grid, cellCenter({ x: 15, z: 10 }), seat, { x: seat.x, z: seat.z + 0.9 });
    expect(route.slice(-1)[0]).toEqual(seat);
    expect(route.length).toBeGreaterThan(1);
    // It steps in from the cell in front of the sofa, not from the dead corner behind it.
    expect(cellOf(route.slice(-2)[0]!)).toEqual({ x: 2, z: 2 });
    expect(routeTo(grid, cellCenter({ x: 15, z: 10 }), seat).length).toBeGreaterThan(1);
    const here = cellCenter({ x: 15, z: 10 });
    expect(routeTo(grid, here, { x: here.x + 0.2, z: here.z })).toEqual([
      { x: here.x + 0.2, z: here.z },
    ]);
  });
});
