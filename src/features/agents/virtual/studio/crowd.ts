import { cellIndex, cellOf, inGrid, type Point } from "./grid";
import { bodyFree, type NavGrid } from "./pathfinding";

/** How far from its middle a standing figure takes up the floor. */
export const BODY = 0.27;
/** A seated figure sits back in its seat, so it takes up less of the floor in front of it. */
const SEATED_BODY = 0.18;
/** How far ahead a walking figure looks for someone in its way, to start stepping round them. */
const LOOKAHEAD = 1.1;
/** How hard it steps aside, as a share of its stride, when someone is right in front of it. */
const DODGE = 0.9;

/** One figure on the floor, as the others see it. */
export interface Body extends Point {
  moving: boolean;
  seated?: boolean;
}

/**
 * Everyone on the floor by id, the person's own figure (`ME`) among them, kept current by the
 * figures every frame so each can keep out of the others' way.
 */
export type Crowd = Map<string, Body>;

/** The person's own figure in walk mode. */
export const ME = "me";

const reachOf = (body: Body) => BODY + (body.seated ? SEATED_BODY : BODY);

/** Whether a place is free of everyone but `self`, or at least no nearer anyone than `from` was. */
export function clearOf(self: string, crowd: Crowd, at: Point, from?: Point): boolean {
  for (const [id, body] of crowd) {
    if (id === self) continue;
    const gap = Math.hypot(at.x - body.x, at.z - body.z);
    if (gap >= reachOf(body) - 1e-3) continue;
    // Already too close (two figures put down together): moving apart is always allowed.
    if (from && gap > Math.hypot(from.x - body.x, from.z - body.z)) continue;
    return false;
  }
  return true;
}

/**
 * Where a walking figure that meant to step from `from` to `to` can actually go with everyone else
 * on the floor. Someone ahead of it is stepped round, each figure keeping to its own side so two
 * that meet head on pass each other; nobody is walked into; and when there is no way past it waits
 * where it is (`blocked`), which the figure uses to find another way.
 */
export function stepThrough(
  self: string,
  from: Point,
  to: Point,
  crowd: Crowd,
  grid: NavGrid,
): { at: Point; blocked: boolean } {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const stride = Math.hypot(dx, dz);
  if (stride < 1e-6) return { at: to, blocked: false };
  const ahead = { x: dx / stride, z: dz / stride };
  // To the figure's own side: two walking toward each other pick opposite sides of the room.
  const aside = { x: ahead.z, z: -ahead.x };
  const at = { x: to.x, z: to.z };
  for (const [id, body] of crowd) {
    if (id === self) continue;
    const ox = body.x - from.x;
    const oz = body.z - from.z;
    const along = ox * ahead.x + oz * ahead.z;
    const across = ox * aside.x + oz * aside.z;
    if (along <= 0 || along > LOOKAHEAD || Math.abs(across) >= reachOf(body)) continue;
    // Away from them, or to its own side when they are dead ahead.
    const away = across > 0.02 ? -1 : 1;
    const push = stride * DODGE * (1 - along / LOOKAHEAD);
    at.x += aside.x * away * push;
    at.z += aside.z * away * push;
  }
  // Nobody is walked into: pushed back out to arm's length of anyone it would touch.
  for (const [id, body] of crowd) {
    if (id === self) continue;
    const gx = at.x - body.x;
    const gz = at.z - body.z;
    const gap = Math.hypot(gx, gz);
    const reach = reachOf(body);
    if (gap >= reach) continue;
    const [ux, uz] = gap > 1e-4 ? [gx / gap, gz / gap] : [-ahead.x, -ahead.z];
    at.x = body.x + ux * reach;
    at.z = body.z + uz * reach;
  }
  // Furniture stops a figure as much as anyone does. One already touching it (a piece put down on
  // top of it) may still walk out.
  const free = (point: Point) => bodyFree(grid, point) || !bodyFree(grid, from);
  if (free(at) && clearOf(self, crowd, at, from)) return { at, blocked: false };
  // Stepping aside ran into furniture: just moving on may still be fine.
  if (free(to) && clearOf(self, crowd, to, from)) return { at: to, blocked: false };
  return { at: { x: from.x, z: from.z }, blocked: true };
}

/**
 * The floor with everyone who is standing still marked as blocked, so a figure that has been held
 * up can be routed round them. Its own cell and the cell it is headed for stay free.
 */
export function gridAround(grid: NavGrid, self: string, crowd: Crowd, keep: Point[]): NavGrid {
  const blocked = grid.blocked.slice();
  const kept = new Set(keep.map((point) => cellIndex(cellOf(point))));
  for (const [id, body] of crowd) {
    if (id === self || body.moving) continue;
    const cell = cellOf(body);
    if (inGrid(cell) && !kept.has(cellIndex(cell))) blocked[cellIndex(cell)] = 1;
  }
  return { blocked, seats: grid.seats };
}
