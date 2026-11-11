import { furniture } from "./catalog";
import { GRID, cellCenter, isDoorCell, yawOf, yawToward, type Cell, type Point } from "./grid";
import { hashOf } from "./look";
import { footprint, itemCells, itemCenter, itemPoint, type OfficeItem } from "./layout";
import { isWalkable, type NavGrid } from "./pathfinding";

/** A place a figure can be: where exactly, which way it looks, and whether it sits there. */
export interface Spot extends Point {
  id: string;
  yaw: number;
  sit: boolean;
  /** Height of the seat's top when it sits. */
  seatY: number;
  /** The floor in front of a seat, which is where a figure steps into it from. */
  via?: Point;
}

export interface OfficePlaces {
  /** Each desk's chair, by the desk's id. */
  desks: Map<string, Spot>;
  /** Sofas and armchairs. */
  lounge: Spot[];
  /** Standing room around the meeting tables. */
  meeting: Spot[];
  /** Places to hang about: by a plant, the water cooler, a bookshelf, on a rug. */
  mingle: Spot[];
  /** In front of the door, where an agent waits for its person. */
  door: Spot[];
}

const standing = (id: string, at: Point, yaw: number): Spot => ({
  id,
  x: at.x,
  z: at.z,
  yaw,
  sit: false,
  seatY: 0,
});

const sides: Cell[] = [
  { x: 0, z: 1 },
  { x: 1, z: 0 },
  { x: -1, z: 0 },
  { x: 0, z: -1 },
];

/** The free cells that touch a piece's footprint. */
function cellsAround(item: OfficeItem, grid: NavGrid): Cell[] {
  const own = itemCells(item).map((entry) => entry.cell);
  const seen = new Set<string>(own.map((cell) => `${cell.x},${cell.z}`));
  const found: Cell[] = [];
  for (const cell of own) {
    for (const side of sides) {
      const next = { x: cell.x + side.x, z: cell.z + side.z };
      const key = `${next.x},${next.z}`;
      if (seen.has(key) || !isWalkable(grid, next) || isDoorCell(next)) continue;
      seen.add(key);
      found.push(next);
    }
  }
  return found;
}

/** Every place in the office a figure may go to, worked out from where the furniture stands. */
export function officePlaces(items: OfficeItem[], grid: NavGrid): OfficePlaces {
  const places: OfficePlaces = { desks: new Map(), lounge: [], meeting: [], mingle: [], door: [] };
  const used = new Set<string>();
  const stand = (list: Spot[], id: string, cell: Cell, toward: Point) => {
    const key = `${cell.x},${cell.z}`;
    if (used.has(key)) return;
    used.add(key);
    const at = cellCenter(cell);
    const yaw = yawToward(at, toward);
    // Lean in a little, so figures stand at the thing and not in the middle of the aisle.
    list.push(
      standing(id, { x: at.x + Math.sin(yaw) * 0.12, z: at.z + Math.cos(yaw) * 0.12 }, yaw),
    );
  };
  for (const item of items) {
    const spec = furniture[item.kind];
    spec.seats?.forEach((seat, index) => {
      const at = itemPoint(item, seat);
      const yaw = seat.yaw + yawOf(item.rot);
      const via = { x: at.x + Math.sin(yaw) * 0.9, z: at.z + Math.cos(yaw) * 0.9 };
      const spot: Spot = { id: `${item.id}:${index}`, ...at, yaw, sit: true, seatY: seat.y, via };
      if (item.kind === "desk") places.desks.set(item.id, spot);
      else places.lounge.push(spot);
    });
  }
  for (const item of items) {
    const spec = furniture[item.kind];
    const center = itemCenter(item);
    if (spec.gather === "around") {
      cellsAround(item, grid).forEach((cell, index) =>
        stand(places.meeting, `${item.id}:${index}`, cell, center),
      );
    }
    if (spec.gather === "front") {
      const size = footprint(item);
      const front = itemPoint(item, { x: 0, z: spec.d / 2 + 0.5 });
      const cells = cellsAround(item, grid).sort(
        (a, b) =>
          Math.hypot(cellCenter(a).x - front.x, cellCenter(a).z - front.z) -
          Math.hypot(cellCenter(b).x - front.x, cellCenter(b).z - front.z),
      );
      // One place per cell of frontage, the nearest to the piece's front first.
      cells.slice(0, Math.max(size.w, size.d) > 1 ? 2 : 1).forEach((cell, index) => {
        stand(places.mingle, `${item.id}:${index}`, cell, center);
      });
    }
  }
  for (const item of items) {
    if (item.kind !== "rug") continue;
    for (const { cell } of itemCells(item)) {
      // Every other cell, so figures on a rug keep some room between them.
      if ((cell.x + cell.z) % 2 || !isWalkable(grid, cell) || isDoorCell(cell)) continue;
      const at = cellCenter(cell);
      const turn = ((hashOf(`${cell.x},${cell.z}`) % 8) * Math.PI) / 4;
      stand(places.mingle, `${item.id}:${cell.x},${cell.z}`, cell, {
        x: at.x + Math.sin(turn),
        z: at.z + Math.cos(turn),
      });
    }
  }
  // By the door, nearest first; they look into the room until the scene turns them to the camera.
  const byDoor: Cell[] = [];
  for (let x = 2; x < 6; x += 1) for (const z of [9, 10, 8, 11]) byDoor.push({ x, z });
  for (const cell of byDoor) {
    if (!isWalkable(grid, cell)) continue;
    const at = cellCenter(cell);
    places.door.push(standing(`door:${cell.x},${cell.z}`, at, Math.PI / 4));
  }
  if (!places.mingle.length && !places.lounge.length) {
    for (let z = 1; z < GRID.d; z += 3) {
      for (let x = 3; x < GRID.w; x += 3) {
        if (isWalkable(grid, { x, z }))
          stand(places.mingle, `floor:${x},${z}`, { x, z }, { x: 0, z: GRID.d });
      }
    }
  }
  return places;
}
