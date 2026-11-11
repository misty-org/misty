import type { Point } from "./grid";

export const furnitureKinds = [
  "desk",
  "sofa",
  "armchair",
  "table",
  "coffee-table",
  "bookshelf",
  "screen",
  "plant",
  "lamp",
  "cooler",
  "rug",
] as const;

export type FurnitureKind = (typeof furnitureKinds)[number];

/** A place to sit that comes with a piece, measured from the middle of its footprint before turning. */
export interface Seat extends Point {
  /** Height of the seat's top. */
  y: number;
  /** The way the sitter looks, before the piece is turned. */
  yaw: number;
}

export interface FurnitureSpec {
  label: string;
  /** Cells across and deep before turning. */
  w: number;
  d: number;
  /** Rows from the back that cannot be walked through; the rest only keep other pieces away. */
  solidRows: number;
  /** Lies flat on the floor, so figures walk over it and other pieces stand on it. */
  flat?: boolean;
  seats?: Seat[];
  /** Figures gather on every side of it, or only in front of it, or not at all. */
  gather?: "around" | "front";
}

export const furniture: Record<FurnitureKind, FurnitureSpec> = {
  // A desk brings its chair: the back row is the desk, the front row is where the chair stands.
  desk: {
    label: "Desk",
    w: 2,
    d: 2,
    solidRows: 1,
    seats: [{ x: 0, z: 0.2, y: 0.36, yaw: Math.PI }],
  },
  sofa: {
    label: "Sofa",
    w: 2,
    d: 1,
    solidRows: 1,
    seats: [
      { x: -0.45, z: 0.08, y: 0.34, yaw: 0 },
      { x: 0.45, z: 0.08, y: 0.34, yaw: 0 },
    ],
  },
  armchair: {
    label: "Armchair",
    w: 1,
    d: 1,
    solidRows: 1,
    seats: [{ x: 0, z: 0.06, y: 0.34, yaw: 0 }],
  },
  table: { label: "Meeting table", w: 2, d: 2, solidRows: 2, gather: "around" },
  "coffee-table": { label: "Coffee table", w: 2, d: 1, solidRows: 1 },
  bookshelf: { label: "Bookshelf", w: 2, d: 1, solidRows: 1, gather: "front" },
  screen: { label: "Screen", w: 2, d: 1, solidRows: 1, gather: "front" },
  plant: { label: "Plant", w: 1, d: 1, solidRows: 1, gather: "front" },
  lamp: { label: "Lamp", w: 1, d: 1, solidRows: 1 },
  cooler: { label: "Water cooler", w: 1, d: 1, solidRows: 1, gather: "front" },
  rug: { label: "Rug", w: 4, d: 3, solidRows: 0, flat: true },
};

export const isFurnitureKind = (value: unknown): value is FurnitureKind =>
  typeof value === "string" && (furnitureKinds as readonly string[]).includes(value);
