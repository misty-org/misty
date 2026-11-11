import { furniture, isFurnitureKind, type FurnitureKind } from "./catalog";
import {
  GRID,
  inGrid,
  isDoorCell,
  rotateOffset,
  sameCell,
  type Cell,
  type Point,
  type Rot,
} from "./grid";

/** One piece of furniture: where its footprint's back-left cell is, and how it is turned. */
export interface OfficeItem {
  id: string;
  kind: FurnitureKind;
  x: number;
  z: number;
  rot: Rot;
  /** For a desk, the agent it belongs to. */
  agent?: string;
}

export interface OfficeLayout {
  items: OfficeItem[];
}

/** Cells across and deep once the piece is turned. */
export function footprint(item: Pick<OfficeItem, "kind" | "rot">): { w: number; d: number } {
  const spec = furniture[item.kind];
  return item.rot % 2 ? { w: spec.d, d: spec.w } : { w: spec.w, d: spec.d };
}

/** The middle of the piece's footprint, in grid units from the back-left corner of the floor. */
function middle(item: OfficeItem): Point {
  const size = footprint(item);
  return { x: item.x + size.w / 2, z: item.z + size.d / 2 };
}

/** The middle of the piece in scene units. */
export function itemCenter(item: OfficeItem): Point {
  const at = middle(item);
  return { x: at.x - GRID.w / 2, z: at.z - GRID.d / 2 };
}

/** A place given from the middle of the piece before turning, in scene units. */
export function itemPoint(item: OfficeItem, local: Point): Point {
  const center = itemCenter(item);
  const turned = rotateOffset(local, item.rot);
  return { x: center.x + turned.x, z: center.z + turned.z };
}

/** Every cell the piece takes, and whether it can be walked through. */
export function itemCells(item: OfficeItem): { cell: Cell; solid: boolean }[] {
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
export function canPlace(items: OfficeItem[], candidate: OfficeItem): boolean {
  const flat = Boolean(furniture[candidate.kind].flat);
  const cells = itemCells(candidate).map((entry) => entry.cell);
  if (!cells.every(inGrid)) return false;
  if (!flat && cells.some(isDoorCell)) return false;
  return items.every((other) => {
    if (other.id === candidate.id || Boolean(furniture[other.kind].flat) !== flat) return true;
    return !itemCells(other).some((entry) => cells.some((cell) => sameCell(cell, entry.cell)));
  });
}

export function moveItem(layout: OfficeLayout, id: string, x: number, z: number): OfficeLayout {
  const item = layout.items.find((entry) => entry.id === id);
  if (!item || (item.x === x && item.z === z)) return layout;
  const moved = { ...item, x, z };
  if (!canPlace(layout.items, moved)) return layout;
  return { items: layout.items.map((entry) => (entry.id === id ? moved : entry)) };
}

/** Turn the piece a quarter turn about its middle, or further if that turn does not fit. */
export function rotateItem(layout: OfficeLayout, id: string): OfficeLayout {
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
      return { items: layout.items.map((entry) => (entry.id === id ? turned : entry)) };
    }
  }
  return layout;
}

/** Add a piece in the free place nearest the middle of the room; null when the room is full. */
export function addItem(
  layout: OfficeLayout,
  kind: FurnitureKind,
): { layout: OfficeLayout; id: string } | null {
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
    const item: OfficeItem = { id, kind, x: origin.x, z: origin.z, rot: 0 };
    if (canPlace(layout.items, item)) return { layout: { items: [...layout.items, item] }, id };
  }
  return null;
}

export const removeItem = (layout: OfficeLayout, id: string): OfficeLayout => ({
  items: layout.items.filter((item) => item.id !== id),
});

/** Give a desk to an agent, or to nobody. An agent has one desk, so its old one is freed. */
export function assignDesk(
  layout: OfficeLayout,
  deskId: string,
  agentId: string | null,
): OfficeLayout {
  return {
    items: layout.items.map((item) => {
      if (item.kind !== "desk") return item;
      const { agent, ...rest } = item;
      if (item.id === deskId) return agentId ? { ...rest, agent: agentId } : rest;
      return agent && agent === agentId ? rest : item;
    }),
  };
}

/** Which desk each agent sits at: the one it was given, else the next desk nobody was given. */
export function deskOwners(items: OfficeItem[], agentIds: string[]): Map<string, string> {
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

const item = (id: string, kind: FurnitureKind, x: number, z: number, rot: Rot = 0): OfficeItem => ({
  id,
  kind,
  x,
  z,
  rot,
});

/** The office as it is before anyone rearranges it: a lounge on the left, four pairs of facing
 * desks along the back, and a meeting table between two more sitting corners in front of them. */
export function defaultLayout(): OfficeLayout {
  const desks = [8, 11, 14, 17].flatMap((x, pair) => [
    item(`desk-${pair * 2 + 1}`, "desk", x, 1, 2),
    item(`desk-${pair * 2 + 2}`, "desk", x, 3, 0),
  ]);
  return {
    items: [
      ...desks,
      item("bookshelf-1", "bookshelf", 0, 0),
      item("lamp-1", "lamp", 4, 0),
      item("sofa-1", "sofa", 2, 1),
      item("rug-1", "rug", 1, 2),
      item("coffee-table-1", "coffee-table", 2, 3),
      item("armchair-1", "armchair", 0, 3, 1),
      item("armchair-2", "armchair", 5, 3, 3),
      item("cooler-1", "cooler", 6, 0),
      item("plant-1", "plant", 0, 6),
      item("plant-2", "plant", 19, 0),
      item("rug-2", "rug", 5, 8),
      item("sofa-2", "sofa", 6, 8),
      item("coffee-table-2", "coffee-table", 6, 10),
      item("armchair-3", "armchair", 4, 9, 1),
      item("lamp-2", "lamp", 8, 8),
      item("screen-1", "screen", 11, 6),
      item("table-1", "table", 11, 8),
      item("plant-4", "plant", 14, 6),
      item("rug-3", "rug", 15, 8),
      item("sofa-3", "sofa", 16, 8),
      item("coffee-table-3", "coffee-table", 16, 10),
      item("armchair-4", "armchair", 14, 9, 1),
      item("lamp-3", "lamp", 18, 8),
      item("plant-3", "plant", 19, 12),
      item("plant-5", "plant", 9, 12),
    ],
  };
}

export const serializeLayout = (layout: OfficeLayout): string =>
  JSON.stringify({ version: 1, items: layout.items });

/** Read a saved layout, keeping only pieces that still make sense and still fit. */
export function parseLayout(text: string | null): OfficeLayout | null {
  if (!text) return null;
  let saved: unknown;
  try {
    saved = JSON.parse(text);
  } catch {
    return null;
  }
  const list = (saved as { items?: unknown } | null)?.items;
  if (!Array.isArray(list)) return null;
  const items: OfficeItem[] = [];
  for (const entry of list as Record<string, unknown>[]) {
    if (!entry || typeof entry.id !== "string" || !isFurnitureKind(entry.kind)) continue;
    const { x, z, rot } = entry;
    if (!Number.isInteger(x) || !Number.isInteger(z) || ![0, 1, 2, 3].includes(rot as number))
      continue;
    const next: OfficeItem = {
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
  return { items };
}
