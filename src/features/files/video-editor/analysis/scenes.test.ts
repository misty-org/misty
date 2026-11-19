import { describe, expect, it } from "vitest";
import {
  belongsToNext,
  findCuts,
  frameDistance,
  frameFeatures,
  scenesBetween,
  type FrameFeatures,
} from "./scenes";

const WIDTH = 64;
const HEIGHT = 36;

/** A frame of a shot: a gradient in one colour, panned `shift` pixels. */
function frame(shot: "warm" | "cold", shift: number): FrameFeatures {
  const rgba = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y++)
    for (let x = 0; x < WIDTH; x++) {
      const p = (y * WIDTH + x) * 4;
      if (shot === "warm") {
        const level = ((x + shift) % WIDTH) / WIDTH;
        rgba.set([220 * level + 30, 120 * level + 20, 40, 255], p);
      } else {
        const level = y / HEIGHT;
        rgba.set([30, 90 + 60 * level, 200 * level + 50, 255], p);
      }
    }
  return frameFeatures(rgba, WIDTH, HEIGHT);
}

/** A video sampled every quarter second: `warm` frames, then the rest `cold` (a hard cut). */
function video(warm: number, total: number) {
  const frames = Array.from({ length: total }, (_, i) =>
    i < warm ? frame("warm", i) : frame("cold", i),
  );
  const times = frames.map((_, i) => i * 0.25);
  const distances = frames.map((each, i) => (i === 0 ? 0 : frameDistance(frames[i - 1], each)));
  return { frames, times, distances };
}

describe("shot changes", () => {
  it("finds a hard cut and nothing in the moving shots around it", () => {
    const { times, distances } = video(12, 24);
    expect(findCuts(times, distances)).toEqual([12]);
  });

  it("finds no cut in one panning shot", () => {
    const { times, distances } = video(30, 30);
    expect(findCuts(times, distances)).toEqual([]);
    expect(Math.max(...distances)).toBeLessThan(0.2);
  });

  it("keeps the stronger of two cuts too close together", () => {
    const times = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5];
    const distances = [0, 0.01, 0.01, 0.01, 0.6, 0.9, 0.01, 0.01, 0.01, 0.01, 0.01];
    expect(findCuts(times, distances)).toEqual([5]);
  });

  it("tells which side of a cut a frame between belongs to", () => {
    const before = frame("warm", 0);
    const after = frame("cold", 0);
    expect(belongsToNext(before, frame("cold", 1), after)).toBe(true);
    expect(belongsToNext(before, frame("warm", 1), after)).toBe(false);
  });

  it("describes each shot's look: the warm one warm, the cold one cold", () => {
    const { frames, times, distances } = video(12, 24);
    const cuts = findCuts(times, distances).map((index) => times[index]);
    const scenes = scenesBetween(
      cuts,
      6,
      frames.map((each, i) => ({ time: times[i], color: each.color })),
    );
    expect(scenes.map((scene) => [scene.start, scene.end])).toEqual([
      [0, 3],
      [3, 6],
    ]);
    expect(scenes[0].warmth).toBeGreaterThan(0.2);
    expect(scenes[1].warmth).toBeLessThan(-0.1);
    expect(scenes[0].brightness).toBeGreaterThan(0);
    expect(scenes[1].contrast).toBeGreaterThan(0);
  });
});
