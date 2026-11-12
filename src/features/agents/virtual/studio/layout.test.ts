import { beforeEach, describe, expect, it } from "vitest";
import { GRID, ROOM, applyRoomSize, isDoorCell, type RoomSize } from "./grid";
import {
  addItem,
  assignDesk,
  canPlace,
  defaultLayout,
  deskOwners,
  itemCells,
  moveItem,
  parseLayout,
  removeItem,
  resizeRoom,
  rotateItem,
  serializeLayout,
  type StudioItem,
} from "./layout";

const desk = (id: string, x: number, z: number, rot: 0 | 1 | 2 | 3 = 0): StudioItem => ({
  id,
  kind: "desk",
  x,
  z,
  rot,
});

const size: RoomSize = { ...ROOM.least };

describe("studio layout", () => {
  beforeEach(() => void applyRoomSize(size));

  it("starts with a layout in which every piece fits", () => {
    const { items } = defaultLayout();
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
    for (const item of items) expect(canPlace(items, item), item.id).toBe(true);
    expect(items.filter((item) => item.kind === "desk")).toHaveLength(12);
  });

  it("turns a desk's cells with the desk", () => {
    const solid = (item: StudioItem) =>
      itemCells(item)
        .filter((entry) => entry.solid)
        .map((entry) => `${entry.cell.x},${entry.cell.z}`)
        .sort();
    expect(solid(desk("a", 4, 4))).toEqual(["4,4", "5,4"]);
    expect(solid(desk("a", 4, 4, 2))).toEqual(["4,5", "5,5"]);
    expect(solid(desk("a", 4, 4, 1))).toEqual(["4,4", "4,5"]);
    expect(solid(desk("a", 4, 4, 3))).toEqual(["5,4", "5,5"]);
  });

  it("keeps pieces on the floor, off the door and off each other, and lets rugs lie under them", () => {
    const items = [desk("a", 4, 4)];
    expect(canPlace(items, desk("b", 5, 5))).toBe(false);
    expect(canPlace(items, desk("b", 6, 4))).toBe(true);
    expect(canPlace(items, desk("b", GRID.w - 1, 4))).toBe(false);
    expect(canPlace(items, { id: "p", kind: "plant", x: 0, z: 9, rot: 0 })).toBe(false);
    expect(isDoorCell({ x: 0, z: 9 })).toBe(true);
    const rug: StudioItem = { id: "r", kind: "rug", x: 3, z: 3, rot: 0 };
    expect(canPlace(items, rug)).toBe(true);
    expect(canPlace([...items, rug], { ...rug, id: "r2", x: 5 })).toBe(false);
  });

  it("moves a piece only to where it fits", () => {
    const layout = { size, items: [desk("a", 4, 4), desk("b", 8, 4)] };
    expect(moveItem(layout, "a", 7, 4)).toBe(layout);
    expect(moveItem(layout, "a", 4, 7).items[0]).toMatchObject({ x: 4, z: 7 });
  });

  it("rotates about the middle and skips turns that do not fit", () => {
    const layout = { size, items: [{ id: "s", kind: "sofa", x: 4, z: 4, rot: 0 } as StudioItem] };
    const turned = rotateItem(layout, "s").items[0]!;
    expect(turned.rot).toBe(1);
    expect(canPlace([], turned)).toBe(true);
    const cornered = { size, items: [{ id: "s", kind: "sofa", x: 0, z: 0, rot: 0 } as StudioItem] };
    expect(canPlace([], rotateItem(cornered, "s").items[0]!)).toBe(true);
  });

  it("adds a piece in a free place with a new id, and removes it again", () => {
    const start = defaultLayout();
    const added = addItem(start, "plant");
    expect(added).not.toBeNull();
    expect(start.items.some((item) => item.id === added!.id)).toBe(false);
    expect(canPlace(added!.layout.items, added!.layout.items.slice(-1)[0]!)).toBe(true);
    expect(removeItem(added!.layout, added!.id).items).toHaveLength(start.items.length);
  });

  it("gives each agent one desk: its own first, then the free ones in order", () => {
    let layout = { size, items: [desk("d1", 0, 0), desk("d2", 3, 0), desk("d3", 6, 0)] };
    layout = assignDesk(layout, "d2", "ada");
    expect(deskOwners(layout.items, ["bo", "ada", "cy", "di"])).toEqual(
      new Map([
        ["ada", "d2"],
        ["bo", "d1"],
        ["cy", "d3"],
      ]),
    );
    layout = assignDesk(layout, "d3", "ada");
    expect(layout.items.map((item) => item.agent)).toEqual([undefined, undefined, "ada"]);
    expect(assignDesk(layout, "d3", null).items.every((item) => !item.agent)).toBe(true);
  });

  it("grows the room, and shrinks it only while everything still fits", () => {
    const layout = { size, items: [desk("a", 17, 4)] };
    const wider = resizeRoom(layout, { w: ROOM.step });
    expect(wider.size).toEqual({ w: size.w + ROOM.step, d: size.d });
    expect(resizeRoom(wider, { w: -ROOM.step }).size).toEqual(size);
    const moved = { ...wider, items: [desk("a", 21, 4)] };
    expect(resizeRoom(moved, { w: -ROOM.step })).toBe(moved);
    expect(resizeRoom(layout, { w: -ROOM.step })).toBe(layout);
    expect(resizeRoom(layout, { d: 400 }).size.d).toBe(ROOM.most.d);
  });

  it("saves and reads a layout, dropping what no longer makes sense", () => {
    const layout = assignDesk(defaultLayout(), "desk-1", "ada");
    expect(parseLayout(serializeLayout(layout))).toEqual(layout);
    expect(parseLayout("not json")).toBeNull();
    expect(parseLayout(null)).toBeNull();
    expect(parseLayout('{"items":3}')).toBeNull();
    const messy = JSON.stringify({
      items: [
        { id: "a", kind: "desk", x: 4, z: 4, rot: 0 },
        { id: "a", kind: "plant", x: 9, z: 9, rot: 0 },
        { id: "b", kind: "throne", x: 1, z: 1, rot: 0 },
        { id: "c", kind: "plant", x: 4, z: 4, rot: 0 },
        { id: "d", kind: "plant", x: 99, z: 1, rot: 0 },
        { id: "e", kind: "plant", x: 1.5, z: 1, rot: 0 },
        { id: "f", kind: "plant", x: 1, z: 1, rot: 7 },
        null,
      ],
    });
    expect(parseLayout(messy)?.items.map((item) => item.id)).toEqual(["a"]);
  });
});
