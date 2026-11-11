import { describe, expect, it } from "vitest";
import { planGoals, RESTLESS_TICKS, type Actor } from "./behaviour";
import { yawToward } from "./grid";
import { defaultLayout, deskOwners, itemCenter } from "./layout";
import { characterLook, hashOf, teamShirts } from "./look";
import { advanceWalker, createWalker, finishWalk, turnToward } from "./motion";
import { buildNavGrid, isWalkable } from "./pathfinding";
import { officePlaces } from "./places";
import { cellOf } from "./grid";

const actor = (id: string, state: Actor["state"], more: Partial<Actor> = {}): Actor => ({
  id,
  name: id,
  owner: "",
  guest: false,
  state,
  doing: "",
  doingCode: "",
  ...more,
});

const { items } = defaultLayout();
const grid = buildNavGrid(items);
const places = officePlaces(items, grid);

describe("office places", () => {
  it("has a chair per desk, facing the desk", () => {
    expect(places.desks.size).toBe(8);
    const desk = items.find((item) => item.id === "desk-2")!;
    const seat = places.desks.get("desk-2")!;
    expect(seat.sit).toBe(true);
    expect(isWalkable(grid, cellOf(seat))).toBe(true);
    // desk-2 is not turned: its top is behind its chair, so the sitter looks toward the back wall.
    expect(Math.cos(seat.yaw)).toBeCloseTo(-1);
    expect(seat.z).toBeGreaterThan(itemCenter(desk).z);
    const turned = places.desks.get("desk-1")!;
    expect(Math.cos(turned.yaw)).toBeCloseTo(1);
  });

  it("finds seats, meeting room, places to hang about and room by the door", () => {
    expect(places.lounge).toHaveLength(10);
    expect(places.meeting.length).toBeGreaterThanOrEqual(6);
    expect(places.mingle.length).toBeGreaterThan(8);
    expect(places.door.length).toBeGreaterThan(4);
    const standing = [...places.meeting, ...places.mingle, ...places.door];
    expect(standing.every((spot) => !spot.sit && isWalkable(grid, cellOf(spot)))).toBe(true);
    expect(new Set(standing.map((spot) => spot.id)).size).toBe(standing.length);
    const table = itemCenter(items.find((item) => item.kind === "table")!);
    for (const spot of places.meeting) expect(spot.yaw).toBeCloseTo(yawToward(spot, table), 1);
  });

  it("still has somewhere to go in an empty room", () => {
    const empty = officePlaces([], buildNavGrid([]));
    expect(empty.mingle.length).toBeGreaterThan(0);
    expect(empty.door.length).toBeGreaterThan(0);
  });
});

describe("office behaviour", () => {
  const desks = deskOwners(items, ["ada", "bo"]);

  it("sits a working agent at its desk, typing", () => {
    const goal = planGoals([actor("ada", "working")], places, desks, 0).get("ada")!;
    expect(goal.activity).toBe("type");
    expect(goal.spot).toBe(places.desks.get(desks.get("ada")!));
  });

  it("sends agents that work together, visitors and the deskless to the meeting table", () => {
    const goals = planGoals(
      [
        actor("ada", "working", { doingCode: "agents" }),
        actor("guest", "working", { guest: true }),
        actor("nodesk", "working"),
      ],
      places,
      desks,
      0,
    );
    for (const goal of goals.values()) {
      expect(goal.activity).toBe("talk");
      expect(places.meeting).toContain(goal.spot);
    }
    expect(new Set([...goals.values()].map((goal) => goal.spot.id)).size).toBe(3);
  });

  it("lines up the ones that need their person at the door, waving", () => {
    const goals = planGoals(
      [actor("ada", "needs-you"), actor("bo", "needs-you")],
      places,
      desks,
      0,
    );
    expect(goals.get("ada")).toMatchObject({ activity: "wave", spot: places.door[0] });
    expect(goals.get("bo")).toMatchObject({ activity: "wave", spot: places.door[1] });
  });

  it("lets resting agents drift: steady within a spell, somewhere new now and then, never shared", () => {
    const crowd = Array.from({ length: 12 }, (_, index) => actor(`agent-${index}`, "resting"));
    const seen = new Set<string>();
    let moves = 0;
    let last = "";
    for (let tick = 0; tick < RESTLESS_TICKS * 8; tick += 1) {
      const goals = planGoals(crowd, places, desks, tick);
      expect(goals.size).toBe(12);
      expect(new Set([...goals.values()].map((goal) => goal.spot.id)).size).toBe(12);
      const spot = goals.get("agent-0")!.spot.id;
      if (spot !== last) moves += 1;
      last = spot;
      seen.add(spot);
      expect(goals.get("agent-0")!.activity).toBe("relax");
    }
    expect(seen.size).toBeGreaterThan(2);
    expect(moves).toBeLessThanOrEqual(8 + 8);
  });

  it("finds everyone a place even when the usual ones run out", () => {
    const bare = officePlaces([], buildNavGrid([]));
    const crowd = Array.from({ length: 6 }, (_, index) => actor(`a${index}`, "working"));
    expect(planGoals(crowd, bare, new Map(), 0).size).toBe(6);
  });
});

describe("office looks and motion", () => {
  it("gives an agent the same look every time, and a team distinct shirts", () => {
    expect(characterLook("ada")).toEqual(characterLook("ada"));
    expect(hashOf("ada")).not.toBe(hashOf("bo"));
    const ids = Array.from({ length: 12 }, (_, index) => `agent-${index}`);
    expect(new Set(teamShirts(ids).values()).size).toBe(12);
    expect(teamShirts([...ids, "one-more"]).size).toBe(13);
  });

  it("turns the short way round", () => {
    expect(turnToward(0, 1, 0.25)).toBeCloseTo(0.25);
    expect(turnToward(0.1, -0.1, 1)).toBeCloseTo(-0.1);
    expect(turnToward(3, -3, 0.1)).toBeCloseTo(3.1);
  });

  it("walks a path at its speed, faces the way it goes, and stops at the end", () => {
    const walker = createWalker({ x: 0, z: 0 }, 0);
    walker.path = [
      { x: 2, z: 0 },
      { x: 2, z: 2 },
    ];
    advanceWalker(walker, 1, 1);
    expect(walker).toMatchObject({ x: 1, z: 0, moving: true });
    expect(walker.yaw).toBeCloseTo(Math.PI / 2);
    advanceWalker(walker, 2, 1);
    expect(walker.x).toBeCloseTo(2);
    expect(walker.z).toBeCloseTo(1);
    advanceWalker(walker, 5, 1);
    expect(walker).toMatchObject({ x: 2, z: 2, moving: false });
    expect(walker.stride).toBeCloseTo(4);
    walker.path = [{ x: 9, z: 9 }];
    finishWalk(walker);
    expect(walker).toMatchObject({ x: 9, z: 9, moving: false, path: [] });
  });
});
