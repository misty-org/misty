import type { FootageColor, FootageScene } from "./types";

/*
 * Shot changes and the look of each shot, from small frames sampled at a steady rate. Two frames
 * of one shot differ a little (things move); across a cut most pixels change and so do the
 * colours, so a frame's distance from the one before stands out against its neighbours'.
 */

/** A sampled frame, as much of it as finding cuts and describing colour needs. */
export interface FrameFeatures {
  /** Luma per pixel, 0 to 1. */
  luma: Float32Array;
  /** 8 bins for each of red, green and blue, each channel's summing to 1. */
  histogram: Float32Array;
  color: FootageColor;
}

const BINS = 8;
/** A distance this large is a cut whatever its neighbours do. */
const SURE_CUT = 0.5;
/** Under this, never a cut. */
const MIN_CUT = 0.22;
/** How far a cut must stand above the frames before it. */
const STAND_OUT = 2.5;
/** The shortest shot kept, in seconds. */
const MIN_SCENE = 0.5;

export function frameFeatures(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): FrameFeatures {
  const pixels = width * height;
  const luma = new Float32Array(pixels);
  const histogram = new Float32Array(BINS * 3);
  let lumaSum = 0;
  let lumaSquares = 0;
  let warmth = 0;
  let tint = 0;
  let chroma = 0;
  for (let p = 0; p < pixels; p++) {
    const r = rgba[p * 4] / 255;
    const g = rgba[p * 4 + 1] / 255;
    const b = rgba[p * 4 + 2] / 255;
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    luma[p] = y;
    lumaSum += y;
    lumaSquares += y * y;
    warmth += r - b;
    tint += g - (r + b) / 2;
    chroma += Math.max(r, g, b) - Math.min(r, g, b);
    histogram[Math.min(BINS - 1, Math.floor(r * BINS))] += 1;
    histogram[BINS + Math.min(BINS - 1, Math.floor(g * BINS))] += 1;
    histogram[2 * BINS + Math.min(BINS - 1, Math.floor(b * BINS))] += 1;
  }
  const count = Math.max(1, pixels);
  for (let i = 0; i < histogram.length; i++) histogram[i] /= count;
  const brightness = lumaSum / count;
  return {
    luma,
    histogram,
    color: {
      brightness,
      contrast: Math.sqrt(Math.max(0, lumaSquares / count - brightness * brightness)),
      warmth: Math.max(-1, Math.min(1, warmth / count)),
      tint: Math.max(-1, Math.min(1, tint / count)),
      saturation: chroma / count,
    },
  };
}

/** How different two frames are, 0 (the same) to 1: changed pixels and changed colours. */
export function frameDistance(a: FrameFeatures, b: FrameFeatures): number {
  const pixels = Math.min(a.luma.length, b.luma.length);
  let change = 0;
  for (let p = 0; p < pixels; p++) change += Math.abs(a.luma[p] - b.luma[p]);
  const lumaChange = Math.min(1, (2 * change) / Math.max(1, pixels));
  let moved = 0;
  for (let i = 0; i < a.histogram.length; i++) moved += Math.abs(a.histogram[i] - b.histogram[i]);
  // Each channel's histogram moves at most 2.
  const colorChange = moved / 6;
  return 0.5 * lumaChange + 0.5 * colorChange;
}

/**
 * Where the cuts are: the indexes of the frames that start a new shot, given each frame's
 * distance from the one before (`distances[0]` is unused) and when each was sampled.
 */
export function findCuts(times: number[], distances: number[]): number[] {
  const cuts: number[] = [];
  for (let i = 1; i < distances.length; i++) {
    const distance = distances[i];
    if (distance < MIN_CUT) continue;
    const before = distances.slice(Math.max(1, i - 6), i).sort((x, y) => x - y);
    const usual = before.length ? before[Math.floor(before.length / 2)] : 0;
    if (distance < SURE_CUT && distance < usual * STAND_OUT + 0.05) continue;
    const previous = cuts[cuts.length - 1];
    const start = previous === undefined ? times[0] : times[previous];
    if (times[i] - start < MIN_SCENE) {
      // Two cuts too close together: the stronger stands. One this close to the start is passed by.
      if (previous !== undefined && distance > distances[previous]) cuts[cuts.length - 1] = i;
      continue;
    }
    cuts.push(i);
  }
  return cuts;
}

/**
 * Whether a frame between the last one of a shot (`before`) and the first of the next (`after`)
 * already belongs to the next shot.
 */
export function belongsToNext(before: FrameFeatures, middle: FrameFeatures, after: FrameFeatures) {
  return frameDistance(middle, after) < frameDistance(middle, before);
}

function averageColor(colors: FootageColor[]): FootageColor {
  const total = { brightness: 0, contrast: 0, warmth: 0, tint: 0, saturation: 0 };
  for (const color of colors)
    for (const key of Object.keys(total) as Array<keyof FootageColor>) total[key] += color[key];
  const count = Math.max(1, colors.length);
  for (const key of Object.keys(total) as Array<keyof FootageColor>) total[key] /= count;
  return total;
}

/** The shots between the cut times, each with the average look of the frames sampled in it. */
export function scenesBetween(
  cutTimes: number[],
  duration: number,
  frames: Array<{ time: number; color: FootageColor }>,
): FootageScene[] {
  const bounds = [0, ...cutTimes.filter((time) => time > 0 && time < duration), duration];
  const scenes: FootageScene[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const [start, end] = [bounds[i], bounds[i + 1]];
    if (end <= start) continue;
    let inside = frames.filter((frame) => frame.time >= start && frame.time < end);
    if (!inside.length && frames.length) {
      const middle = (start + end) / 2;
      const nearest = frames.reduce((best, frame) =>
        Math.abs(frame.time - middle) < Math.abs(best.time - middle) ? frame : best,
      );
      inside = [nearest];
    }
    scenes.push({ start, end, ...averageColor(inside.map((frame) => frame.color)) });
  }
  return scenes;
}
