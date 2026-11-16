import { furniture, isFurnitureKind, type FurnitureKind } from "./catalog";
import {
  GRID,
  ROOM,
  applyRoomSize,
  inGrid,
  isDoorCell,
  rotateOffset,
  sameCell,
  type Cell,
  type Point,
  type Rot,
  type RoomSize,
  roomSize,
} from "./grid";

/** One piece of furniture: where its footprint's back-left cell is, and how it is turned. */
export interface StudioItem {
  id: string;
  kind: FurnitureKind;
  x: number;
  z: number;
  rot: Rot;
  /** For a desk, the agent it belongs to. */
  agent?: string;
}

export interface StudioLayout {
  items: StudioItem[];
  /** The floor's size in cells. */
  size: RoomSize;
}

/** Cells across and deep once the piece is turned. */
export function footprint(item: Pick<StudioItem, "kind" | "rot">): { w: number; d: number } {
  const spec = furniture[item.kind];
  return item.rot % 2 ? { w: spec.d, d: spec.w } : { w: spec.w, d: spec.d };
}

/** The middle of the piece's footprint, in grid units from the back-left corner of the floor. */
function middle(item: StudioItem): Point {
  const size = footprint(item);
  return { x: item.x + size.w / 2, z: item.z + size.d / 2 };
}

/** The middle of the piece in scene units. */
export function itemCenter(item: StudioItem): Point {
  const at = middle(item);
  return { x: at.x - GRID.w / 2, z: at.z - GRID.d / 2 };
}

/** A place given from the middle of the piece before turning, in scene units. */
export function itemPoint(item: StudioItem, local: Point): Point {
  const center = itemCenter(item);
  const turned = rotateOffset(local, item.rot);
  return { x: center.x + turned.x, z: center.z + turned.z };
}

/** Every cell the piece takes, and whether it can be walked through. */
export function itemCells(item: StudioItem): { cell: Cell; solid: boolean }[] {
  const spec = furniture[item.kind];
  const at = middle(item);
  const cells: { cell: Cell; solid: boolean }[] = [];
  for (let lz = 0; lz < spec.d; lz += 1) {
    for (let lx = 0; lx < spec.w; lx += 1) {
      const turned = rotateOffset({ x: lx + 0.5 - spec.w / 2, z: lz + 0.5 - spec.d / 2 }, item.rot);
      cells.push({
        cell: { x: Math.floor(at.x + turned.x), z: Math.floor(at.z + turned.z) },
        solid: lz < spec.solidRows,
      });
    }
  }
  return cells;
}

/** Whether the piece fits where it is: on the floor, clear of the door and of other pieces.
 * Rugs lie under everything, so they only keep away from other rugs. */
export function canPlace(items: StudioItem[], candidate: StudioItem): boolean {
  const flat = Boolean(furniture[candidate.kind].flat);
  const cells = itemCells(candidate).map((entry) => entry.cell);
  if (!cells.every(inGrid)) return false;
  if (!flat && cells.some(isDoorCell)) return false;
  return items.every((other) => {
    if (other.id === candidate.id || Boolean(furniture[other.kind].flat) !== flat) return true;
    return !itemCells(other).some((entry) => cells.some((cell) => sameCell(cell, entry.cell)));
  });
}

export function moveItem(layout: StudioLayout, id: string, x: number, z: number): StudioLayout {
  const item = layout.items.find((entry) => entry.id === id);
  if (!item || (item.x === x && item.z === z)) return layout;
  const moved = { ...item, x, z };
  if (!canPlace(layout.items, moved)) return layout;
  return { ...layout, items: layout.items.map((entry) => (entry.id === id ? moved : entry)) };
}

/** Turn the piece a quarter turn about its middle, or further if that turn does not fit. */
export function rotateItem(layout: StudioLayout, id: string): StudioLayout {
  const item = layout.items.find((entry) => entry.id === id);
  if (!item) return layout;
  const at = middle(item);
  for (let turn = 1; turn < 4; turn += 1) {
    const rot = ((item.rot + turn) % 4) as Rot;
    const size = footprint({ kind: item.kind, rot });
    const turned = {
      ...item,
      rot,
      x: Math.round(at.x - size.w / 2),
      z: Math.round(at.z - size.d / 2),
    };
    if (canPlace(layout.items, turned)) {
      return { ...layout, items: layout.items.map((entry) => (entry.id === id ? turned : entry)) };
    }
  }
  return layout;
}

/** Add a piece in the free place nearest the middle of the room; null when the room is full. */
export function addItem(
  layout: StudioLayout,
  kind: FurnitureKind,
): { layout: StudioLayout; id: string } | null {
  const taken = new Set(layout.items.map((item) => item.id));
  let count = 1;
  while (taken.has(`${kind}-${count}`)) count += 1;
  const id = `${kind}-${count}`;
  const spec = furniture[kind];
  const origins: Cell[] = [];
  for (let z = 0; z <= GRID.d - spec.d; z += 1) {
    for (let x = 0; x <= GRID.w - spec.w; x += 1) origins.push({ x, z });
  }
  const off = (cell: Cell) =>
    Math.hypot(cell.x + spec.w / 2 - GRID.w / 2, cell.z + spec.d / 2 - (GRID.d / 2 + 1.5));
  origins.sort((a, b) => off(a) - off(b));
  for (const origin of origins) {
    const item: StudioItem = { id, kind, x: origin.x, z: origin.z, rot: 0 };
    if (canPlace(layout.items, item))
      return { layout: { ...layout, items: [...layout.items, item] }, id };
  }
  return null;
}

export const removeItem = (layout: StudioLayout, id: string): StudioLayout => ({
  ...layout,
  items: layout.items.filter((item) => item.id !== id),
});

/** Give a desk to an agent, or to nobody. An agent has one desk, so its old one is freed. */
export function assignDesk(
  layout: StudioLayout,
  deskId: string,
  agentId: string | null,
): StudioLayout {
  return {
    ...layout,
    items: layout.items.map((item) => {
      if (item.kind !== "desk") return item;
      const { agent, ...rest } = item;
      if (item.id === deskId) return agentId ? { ...rest, agent: agentId } : rest;
      return agent && agent === agentId ? rest : item;
    }),
  };
}

/** Which desk each agent sits at: the one it was given, else the next desk nobody was given. */
export function deskOwners(items: StudioItem[], agentIds: string[]): Map<string, string> {
  const owners = new Map<string, string>();
  const desks = items.filter((item) => item.kind === "desk");
  for (const desk of desks) {
    if (desk.agent && agentIds.includes(desk.agent) && !owners.has(desk.agent))
      owners.set(desk.agent, desk.id);
  }
  const given = new Set(owners.values());
  const free = desks.filter((desk) => !given.has(desk.id) && !desk.agent);
  for (const id of agentIds) {
    if (owners.has(id)) continue;
    const desk = free.shift();
    if (!desk) break;
    owners.set(id, desk.id);
  }
  return owners;
}

const item = (id: string, kind: FurnitureKind, x: number, z: number, rot: Rot = 0): StudioItem => ({
  id,
  kind,
  x,
  z,
  rot,
});

/** A sitting corner: a rug with a sofa, a coffee table, an armchair and a lamp on it. */
const corner = (n: number, x: number, z: number): StudioItem[] => [
  item(`rug-${n}`, "rug", x, z),
  item(`sofa-${n}`, "sofa", x + 1, z),
  item(`coffee-table-${n}`, "coffee-table", x + 1, z + 2),
  item(`armchair-${n}`, "armchair", x - 1, z + 1, 1),
  item(`lamp-${n}`, "lamp", x + 3, z),
];

/** Where walls four cells long go end to end from `from` toward `to` (either way), short of it,
 * nearest the start first. */
function wallRun(from: number, to: number): number[] {
  const out: number[] = [];
  if (to >= from) for (let at = from; at + 4 <= to; at += 4) out.push(at);
  else for (let at = from; at >= to; at -= 4) out.push(at);
  return out;
}

/**
 * The studio as it is before anyone rearranges it, measured from the floor it is given: rooms
 * with doorways between them, so walking through it goes somewhere. Along the back, the office:
 * rows of facing desks, a second row in a deep room, with a sofa corner at each end of the aisle
 * in front of them. Across the front, rooms that keep their share of the floor as it grows: the
 * lounge at the left, where resting agents sit; the meeting room at the right, two tables under
 * their screens, where agents work out a task given to several; between them the games corner,
 * open to the office and empty for what the studio earns (`addItem` puts new pieces near there).
 * The way in is the door in the left wall, onto the office.
 */
export function defaultLayout(given: RoomSize = ROOM.start): StudioLayout {
  const size = roomSize(given);
  applyRoomSize(size);
  const { w, d } = size;
  /** The row of walls between the office and the rooms across the front. */
  const row = Math.round(d * 0.54);
  /** Where the lounge ends and the meeting room starts. */
  const lounge = Math.round(w * 0.3);
  const meeting = w - Math.round(w * 0.39);
  const pairs = Math.max(1, Math.min(10, Math.floor((w - 17) / 3)));
  const deskRows = row >= 17 ? [1, 7] : [1];
  let deskCount = 0;
  const desks = deskRows.flatMap((z) =>
    Array.from({ length: pairs }, (_, pair) => 13 + pair * 3).flatMap((x) => [
      item(`desk-${++deskCount}`, "desk", x, z, 2),
      item(`desk-${++deskCount}`, "desk", x, z + 2, 0),
    ]),
  );
  let walls = 0;
  const across = (x: number) => item(`wall-${++walls}`, "wall", x, row);
  const down = (x: number) => (z: number) => item(`wall-${++walls}`, "wall", x, z, 1);
  const corners = row - 6;
  const wanted: StudioItem[] = [
    // The office.
    ...desks,
    item("bookshelf-1", "bookshelf", 0, 0),
    item("lamp-1", "lamp", 4, 0),
    item("cooler-1", "cooler", 6, 0),
    item("plant-1", "plant", 0, 6),
    item("plant-2", "plant", w - 1, 0),
    ...corner(3, 14, corners),
    ...corner(4, w - 11, corners),
    item("bookshelf-2", "bookshelf", w - 3, row - 8),
    item("plant-8", "plant", w - 1, row - 2),
    // The walls that make the rooms, with their doorways left open: the lounge's into the office
    // by its corner and into the games corner at the front; the meeting room's into the office
    // after its first stretch, and into the games corner halfway down.
    ...wallRun(0, lounge - 3).map(across),
    across(meeting),
    ...wallRun(w - 4, meeting + 6)
      .reverse()
      .map(across),
    ...wallRun(row + 1, d - 2).map(down(lounge)),
    down(meeting - 1)(row + 1),
    ...wallRun(d - 4, row + 7)
      .reverse()
      .map(down(meeting - 1)),
    // The lounge.
    ...corner(2, 2, row + 3),
    item("armchair-5", "armchair", lounge - 4, row + 4, 3),
    item("cooler-3", "cooler", 0, row + 1),
    item("bookshelf-3", "bookshelf", lounge - 5, row + 1),
    item("plant-3", "plant", 0, d - 1),
    item("plant-4", "plant", lounge - 1, d - 1),
    // The games corner.
    item("rug-5", "rug", lounge + 3, row + 5),
    item("plant-5", "plant", lounge + 1, d - 1),
    item("plant-6", "plant", meeting - 2, d - 1),
    // The meeting room.
    item("screen-1", "screen", meeting + 2, row + 1),
    item("table-1", "table", meeting + 2, row + 3),
    item("screen-2", "screen", w - 5, row + 1),
    item("table-2", "table", w - 5, row + 3),
    item("plant-7", "plant", w - 1, d - 1),
    item("plant-9", "plant", meeting, d - 1),
  ];
  // Anything a small floor has no room for is left out rather than piled up.
  const items: StudioItem[] = [];
  for (const next of wanted) if (canPlace(items, next)) items.push(next);
  return { size, items };
}

/** A layout's pieces without whose desk is whose, to tell whether it was ever rearranged. */
const arrangement = (items: readonly StudioItem[]) =>
  JSON.stringify(
    items
      .map(({ id, kind, x, z, rot }) => [id, kind, x, z, rot])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );

/** Works something out on a floor of another size, then puts the floor back as it was. */
function onFloor<T>(size: RoomSize, work: () => T): T {
  const before = { w: GRID.w, d: GRID.d };
  applyRoomSize(size);
  try {
    return work();
  } finally {
    applyRoomSize(before);
  }
}

/**
 * The default layout for `size` if `layout` is still the default as it came (for its own size, or
 * the starting room it was first laid out in before the floor grew), keeping whose desk is whose;
 * otherwise null.
 */
function freshDefault(layout: StudioLayout, size: RoomSize): StudioLayout | null {
  const now = arrangement(layout.items);
  const untouched = onFloor(
    layout.size,
    () =>
      now === arrangement(defaultLayout(layout.size).items) ||
      now === arrangement(defaultLayout(ROOM.start).items),
  );
  if (!untouched) return null;
  const owners = new Map(
    layout.items.flatMap((entry) => (entry.agent ? [[entry.id, entry.agent] as const] : [])),
  );
  const fresh = onFloor(size, () => defaultLayout(size));
  return {
    size: fresh.size,
    items: fresh.items.map((entry) =>
      owners.has(entry.id) ? { ...entry, agent: owners.get(entry.id) } : entry,
    ),
  };
}

/**
 * A saved layout that is still the starting default on a floor that has since grown, laid out
 * afresh for that floor. Anything rearranged is kept as it is.
 */
export function refitDefault(layout: StudioLayout): StudioLayout {
  if (layout.size.w === ROOM.start.w && layout.size.d === ROOM.start.d) return layout;
  return freshDefault(layout, layout.size) ?? layout;
}

/**
 * The room made wider or deeper, or smaller when nothing would be left outside it. A room still
 * as it came is laid out afresh for its new size, keeping whose desk is whose. Otherwise, growing,
 * the rooms along the front keep to the front wall and the meeting room to the right one, so the
 * new floor opens up inside the rooms rather than as an empty strip along the edge; the desks stay
 * where they are. Shrinking keeps every piece in its cells.
 */
export function resizeRoom(layout: StudioLayout, by: Partial<RoomSize>): StudioLayout {
  const size = roomSize({ w: layout.size.w + (by.w ?? 0), d: layout.size.d + (by.d ?? 0) });
  if (size.w === layout.size.w && size.d === layout.size.d) return layout;
  const fresh = freshDefault(layout, size);
  if (fresh) return fresh;
  if (size.w >= layout.size.w && size.d >= layout.size.d) {
    const dw = size.w - layout.size.w;
    const dd = size.d - layout.size.d;
    const moved = layout.items.map((entry) => {
      if (entry.kind === "desk") return entry;
      const at = middle(entry);
      const x = entry.x + (at.x > layout.size.w * 0.6 ? dw : 0);
      const z = entry.z + (at.z > layout.size.d * 0.5 ? dd : 0);
      return x === entry.x && z === entry.z ? entry : { ...entry, x, z };
    });
    if (
      moved.some((entry, index) => entry !== layout.items[index]) &&
      onFloor(size, () => moved.every((entry) => canPlace(moved, entry)))
    )
      return { size, items: moved };
  }
  const fits = layout.items.every((entry) =>
    itemCells(entry).every(({ cell }) => cell.x < size.w && cell.z < size.d),
  );
  return fits ? { ...layout, size } : layout;
}

export const serializeLayout = (layout: StudioLayout): string =>
  JSON.stringify({ version: 2, size: layout.size, items: layout.items });

/** Read a saved layout, keeping only pieces that still make sense and still fit. */
export function parseLayout(text: string | null): StudioLayout | null {
  if (!text) return null;
  let saved: unknown;
  try {
    saved = JSON.parse(text);
  } catch {
    return null;
  }
  const list = (saved as { items?: unknown } | null)?.items;
  if (!Array.isArray(list)) return null;
  // An arrangement saved before rooms could grow was made for the smallest room.
  const kept = (saved as { size?: Partial<RoomSize> }).size;
  const size = kept ? roomSize(kept) : { ...ROOM.least };
  applyRoomSize(size);
  const items: StudioItem[] = [];
  for (const entry of list as Record<string, unknown>[]) {
    if (!entry || typeof entry.id !== "string" || !isFurnitureKind(entry.kind)) continue;
    const { x, z, rot } = entry;
    if (!Number.isInteger(x) || !Number.isInteger(z) || ![0, 1, 2, 3].includes(rot as number))
      continue;
    const next: StudioItem = {
      id: entry.id,
      kind: entry.kind,
      x: x as number,
      z: z as number,
      rot: rot as Rot,
    };
    if (entry.kind === "desk" && typeof entry.agent === "string" && entry.agent)
      next.agent = entry.agent;
    if (items.some((known) => known.id === next.id) || !canPlace(items, next)) continue;
    items.push(next);
  }
  return { items, size };
}
