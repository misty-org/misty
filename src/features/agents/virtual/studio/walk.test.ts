import { describe, expect, it } from "vitest";
import { nearestAhead, stepWalker, type Walker, type WalkInput } from "./Walk";
import { mentionAt } from "../StudioBox";

describe("walking up to an agent", () => {
  const anchors = new Map([
    ["ahead", { x: 0, z: 1.2 }],
    ["behind", { x: 0, z: -0.8 }],
    ["far", { x: 0, z: 5 }],
  ]);

  it("finds the agent in front, within reach", () => {
    expect(nearestAhead({ x: 0, z: 0, yaw: 0 }, ["ahead", "behind", "far"], anchors)).toBe("ahead");
  });

  it("finds nobody when the person looks away", () => {
    expect(nearestAhead({ x: 0, z: 0, yaw: Math.PI / 2 }, ["ahead", "far"], anchors)).toBeNull();
  });
});

describe("mentionAt", () => {
  it("reads the name being typed after an @", () => {
    expect(mentionAt("hi @Cla", 7)).toEqual({ start: 3, query: "Cla" });
    expect(mentionAt("@Claude Co", 10)).toEqual({ start: 0, query: "Claude Co" });
  });

  it("ignores an @ inside a word", () => {
    expect(mentionAt("me@codex", 8)).toBeNull();
  });
});

describe("stepWalker", () => {
  const fresh = (): Walker => ({ x: 0, z: 0, y: 0, yaw: 0, vx: 0, vz: 0, vy: 0, stride: 0 });
  const run = (self: Walker, held: string[], cameraYaw: number, frames = 60, blocked = false) => {
    for (let frame = 0; frame < frames; frame += 1)
      stepWalker(
        self,
        { held: new Set(held) as WalkInput["held"], cameraYaw },
        1 / 60,
        () => !blocked,
      );
    return self;
  };

  it("walks away from the camera on W, whichever way the camera looks", () => {
    // Camera south of the figure (yaw 0) looks north, toward -z.
    expect(run(fresh(), ["ahead"], 0).z).toBeLessThan(-2);
    // Camera west of it looks east, toward +x.
    expect(run(fresh(), ["ahead"], -Math.PI / 2).x).toBeGreaterThan(2);
  });

  it("strafes on A and D and turns to face the way it goes", () => {
    const self = run(fresh(), ["right"], 0);
    expect(self.x).toBeGreaterThan(2);
    expect(Math.sin(self.yaw)).toBeCloseTo(1, 1);
    expect(run(fresh(), ["left"], 0).x).toBeLessThan(-2);
  });

  it("goes no faster on a slant than straight on", () => {
    const straight = run(fresh(), ["ahead"], 0);
    const slant = run(fresh(), ["ahead", "right"], 0);
    expect(Math.hypot(slant.x, slant.z)).toBeCloseTo(Math.hypot(straight.x, straight.z), 1);
  });

  it("jumps off the floor and comes back down", () => {
    const self = fresh();
    run(self, ["jump"], 0, 6);
    expect(self.y).toBeGreaterThan(0);
    run(self, [], 0, 120);
    expect(self.y).toBe(0);
  });

  it("is stopped by what it can't stand in", () => {
    const self = run(fresh(), ["ahead"], 0, 60, true);
    expect([self.x, self.z, self.vz]).toEqual([0, 0, 0]);
  });
});
