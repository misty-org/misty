/** How big a studio may be, in cells: what a new one starts as and how far it can grow. */
export const ROOM = {
  start: { w: 28, d: 18 },
  least: { w: 20, d: 13 },
  most: { w: 48, d: 32 },
  /** Cells added or taken away at a time. */
  step: 4,
} as const;

export interface RoomSize {
  w: number;
  d: number;
}

/**
 * The studio floor is a grid of square cells, one scene unit each, centred on the scene's origin.
 * Its size belongs to the layout being shown: `applyRoomSize` sets it before anything is worked out
 * from it, so every measure below reads the room that is on screen.
 */
export const GRID: RoomSize = { ...ROOM.least };

const whole = (value: number, least: number, most: number) =>
  Math.min(most, Math.max(least, Math.round(value)));

/** A size inside what a room may be. */
export const roomSize = (size: Partial<RoomSize> | null | undefined): RoomSize => ({
  w: whole(size?.w ?? ROOM.start.w, ROOM.least.w, ROOM.most.w),
  d: whole(size?.d ?? ROOM.start.d, ROOM.least.d, ROOM.most.d),
});

/** Makes the floor this size. Returns whether it changed. */
export function applyRoomSize(size: RoomSize): boolean {
  if (GRID.w === size.w && GRID.d === size.d) return false;
  GRID.w = size.w;
  GRID.d = size.d;
  return true;
}

/** A square of the floor, counted from the back-left corner. */
export interface Cell {
  x: number;
  z: number;
}

/** A place on the floor in scene units. */
export interface Point {
  x: number;
  z: number;
}

/** Quarter turns about the vertical axis. */
export type Rot = 0 | 1 | 2 | 3;

export const cellCenter = (cell: Cell): Point => ({
  x: cell.x + 0.5 - GRID.w / 2,
  z: cell.z + 0.5 - GRID.d / 2,
});

export const cellOf = (point: Point): Cell => ({
  x: Math.floor(point.x + GRID.w / 2),
  z: Math.floor(point.z + GRID.d / 2),
});

export const inGrid = (cell: Cell): boolean =>
  cell.x >= 0 && cell.z >= 0 && cell.x < GRID.w && cell.z < GRID.d;

export const cellIndex = (cell: Cell): number => cell.z * GRID.w + cell.x;

export const sameCell = (a: Cell, b: Cell): boolean => a.x === b.x && a.z === b.z;

export const yawOf = (rot: Rot): number => (rot * Math.PI) / 2;

/** Turn an offset by quarter turns, the way a scene object turned about its vertical axis moves it. */
export function rotateOffset(offset: Point, rot: Rot): Point {
  let { x, z } = offset;
  for (let turn = 0; turn < rot; turn += 1) [x, z] = [z, -x];
  return { x: x === 0 ? 0 : x, z: z === 0 ? 0 : z };
}

/** The direction a figure turned to `yaw` looks in. */
export const facing = (yaw: number): Point => ({ x: Math.sin(yaw), z: Math.cos(yaw) });

/** The turn that looks from one place toward another. */
export const yawToward = (from: Point, to: Point): number =>
  Math.atan2(to.x - from.x, to.z - from.z);

/** The cells kept clear in front of the door, which is in the left wall. */
export const DOOR = { z: 10, cells: [8, 9, 10, 11].flatMap((z) => [0, 1].map((x) => ({ x, z }))) };

export const isDoorCell = (cell: Cell): boolean => DOOR.cells.some((door) => sameCell(door, cell));
