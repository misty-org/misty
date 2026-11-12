import {
  GRID,
  cellCenter,
  cellIndex,
  cellOf,
  inGrid,
  sameCell,
  type Cell,
  type Point,
  type RoomSize,
} from "./grid";
import { itemCells, type StudioItem } from "./layout";

/** Which cells of the floor a figure cannot walk through. */
export interface NavGrid {
  blocked: Uint8Array;
}

/** The floor's blocked cells. `size` is the room the pieces stand in, the one on screen by default. */
export function buildNavGrid(items: StudioItem[], size: RoomSize = GRID): NavGrid {
  const blocked = new Uint8Array(size.w * size.d);
  for (const item of items) {
    for (const { cell, solid } of itemCells(item)) {
      if (solid && inGrid(cell)) blocked[cellIndex(cell)] = 1;
    }
  }
  return { blocked };
}

export const isWalkable = (grid: NavGrid, cell: Cell): boolean =>
  inGrid(cell) && !grid.blocked[cellIndex(cell)];

const steps: Cell[] = [
  { x: 1, z: 0 },
  { x: -1, z: 0 },
  { x: 0, z: 1 },
  { x: 0, z: -1 },
  { x: 1, z: 1 },
  { x: 1, z: -1 },
  { x: -1, z: 1 },
  { x: -1, z: -1 },
];

/** The walkable cell closest to a cell, itself included; null when there is none. With `within`,
 * only cells marked there count, which keeps the answer to cells a figure can actually get to. */
export function nearestWalkable(grid: NavGrid, cell: Cell, within?: Uint8Array): Cell | null {
  let best: Cell | null = null;
  let bestOff = Infinity;
  for (let z = 0; z < GRID.d; z += 1) {
    for (let x = 0; x < GRID.w; x += 1) {
      const index = cellIndex({ x, z });
      if (grid.blocked[index] || (within && !within[index])) continue;
      const off = Math.hypot(x - cell.x, z - cell.z);
      if (off < bestOff) [best, bestOff] = [{ x, z }, off];
    }
  }
  return best;
}

/** A step may go diagonally only when both cells it squeezes between are free. */
function canStep(grid: NavGrid, from: Cell, step: Cell): boolean {
  const to = { x: from.x + step.x, z: from.z + step.z };
  if (!isWalkable(grid, to)) return false;
  if (!step.x || !step.z) return true;
  return (
    isWalkable(grid, { x: from.x + step.x, z: from.z }) &&
    isWalkable(grid, { x: from.x, z: from.z + step.z })
  );
}

/** The shortest walk between two free cells, both included; null when there is no way through. */
export function findPath(grid: NavGrid, from: Cell, to: Cell): Cell[] | null {
  if (!isWalkable(grid, from) || !isWalkable(grid, to)) return null;
  const size = GRID.w * GRID.d;
  const cost = new Float64Array(size).fill(Infinity);
  const cameFrom = new Int32Array(size).fill(-1);
  const closed = new Uint8Array(size);
  const open: Cell[] = [from];
  const guess = (cell: Cell) => {
    const dx = Math.abs(cell.x - to.x);
    const dz = Math.abs(cell.z - to.z);
    return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
  };
  cost[cellIndex(from)] = 0;
  while (open.length) {
    let pick = 0;
    for (let index = 1; index < open.length; index += 1) {
      const better = cost[cellIndex(open[index]!)]! + guess(open[index]!);
      if (better < cost[cellIndex(open[pick]!)]! + guess(open[pick]!)) pick = index;
    }
    const current = open.splice(pick, 1)[0]!;
    if (sameCell(current, to)) {
      const path = [current];
      for (let at = cameFrom[cellIndex(current)]!; at >= 0; at = cameFrom[at]!) {
        path.unshift({ x: at % GRID.w, z: Math.floor(at / GRID.w) });
      }
      return path;
    }
    if (closed[cellIndex(current)]) continue;
    closed[cellIndex(current)] = 1;
    for (const step of steps) {
      if (!canStep(grid, current, step)) continue;
      const next = { x: current.x + step.x, z: current.z + step.z };
      const reached = cost[cellIndex(current)]! + (step.x && step.z ? Math.SQRT2 : 1);
      if (reached >= cost[cellIndex(next)]!) continue;
      cost[cellIndex(next)] = reached;
      cameFrom[cellIndex(next)] = cellIndex(current);
      open.push(next);
    }
  }
  return null;
}

/** Whether a figure can walk straight between two places without brushing a blocked cell. */
export function lineClear(grid: NavGrid, a: Point, b: Point): boolean {
  const length = Math.hypot(b.x - a.x, b.z - a.z);
  if (!length) return true;
  // A figure has shoulders: check a line on either side of the middle one.
  const side = { x: (-(b.z - a.z) / length) * 0.3, z: ((b.x - a.x) / length) * 0.3 };
  const count = Math.ceil(length / 0.2);
  for (let index = 0; index <= count; index += 1) {
    const x = a.x + ((b.x - a.x) * index) / count;
    const z = a.z + ((b.z - a.z) * index) / count;
    for (const lean of [-1, 0, 1]) {
      if (!isWalkable(grid, cellOf({ x: x + side.x * lean, z: z + side.z * lean }))) return false;
    }
  }
  return true;
}

/** Drop the corners of a path that a straight walk can skip, so figures do not zigzag. */
export function smoothPath(grid: NavGrid, cells: Cell[]): Cell[] {
  if (cells.length < 3) return cells;
  const kept = [cells[0]!];
  let anchor = 0;
  while (anchor < cells.length - 1) {
    let reach = cells.length - 1;
    while (
      reach > anchor + 1 &&
      !lineClear(grid, cellCenter(cells[anchor]!), cellCenter(cells[reach]!))
    )
      reach -= 1;
    kept.push(cells[reach]!);
    anchor = reach;
  }
  return kept;
}

/** Every cell a figure standing on `from` can walk to. */
export function reachable(grid: NavGrid, from: Cell): Uint8Array {
  const seen = new Uint8Array(GRID.w * GRID.d);
  if (!isWalkable(grid, from)) return seen;
  const queue = [from];
  seen[cellIndex(from)] = 1;
  while (queue.length) {
    const current = queue.pop()!;
    for (const step of steps) {
      const next = { x: current.x + step.x, z: current.z + step.z };
      if (!canStep(grid, current, step) || seen[cellIndex(next)]) continue;
      seen[cellIndex(next)] = 1;
      queue.push(next);
    }
  }
  return seen;
}

/** The places to walk through to get from where a figure stands to a place, ending exactly there.
 * A place inside a piece, like a sofa seat, is entered from `via`, the floor in front of it. */
export function routeTo(grid: NavGrid, from: Point, to: Point, via: Point = to): Point[] {
  const start = nearestWalkable(grid, cellOf(from));
  if (!start) return [to];
  const end = nearestWalkable(grid, cellOf(via), reachable(grid, start));
  const path = end && findPath(grid, start, end);
  if (!path) return [to];
  const points = smoothPath(grid, path).map(cellCenter);
  // The figure is already near the first cell's middle; walking back to it would look like a stutter.
  if (points.length > 1 || sameCell(start, cellOf(from))) points.shift();
  return [...points, to];
}
