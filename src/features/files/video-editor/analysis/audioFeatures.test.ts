import { describe, expect, it } from "vitest";
import {
  AudioFeatureStream,
  FLOOR_DB,
  LOUDNESS_STEP,
  silencesOf,
  silenceThresholdOf,
} from "./audioFeatures";

const RATE = 8000;

/** A 440 Hz tone at `amplitude` for `seconds`. */
const tone = (seconds: number, amplitude: number) =>
  Float32Array.from(
    { length: Math.round(seconds * RATE) },
    (_, i) => amplitude * Math.sin((2 * Math.PI * 440 * i) / RATE),
  );

function loudnessOf(...parts: Float32Array[]) {
  const stream = new AudioFeatureStream(RATE);
  for (const part of parts) stream.push(part);
  return stream.finish();
}

describe("the loudness of a sound", () => {
  it("reads a tone's RMS level in dB at a steady step", () => {
    const features = loudnessOf(tone(2, 0.5));
    expect(features.duration).toBeCloseTo(2, 5);
    expect(features.loudness).toHaveLength(Math.round(2 / LOUDNESS_STEP));
    // A sine's RMS is its amplitude over √2: 0.5 is about -9 dB.
    for (const db of features.loudness) expect(db).toBeCloseTo(-9.03, 0);
  });

  it("finds the silence between two stretches of sound", () => {
    const { loudness } = loudnessOf(tone(1, 0.5), new Float32Array(RATE), tone(1, 0.5));
    expect(loudness[12]).toBe(FLOOR_DB);
    const threshold = silenceThresholdOf(loudness);
    expect(threshold).toBeLessThan(-30);
    const silences = silencesOf(loudness, LOUDNESS_STEP, threshold);
    expect(silences).toHaveLength(1);
    expect(silences[0][0]).toBeCloseTo(1, 1);
    expect(silences[0][1]).toBeCloseTo(2, 1);
  });

  it("passes over pauses too short to be silences", () => {
    const loudness = [-10, -10, -80, -80, -10, -80, -80, -80, -80, -80];
    expect(silencesOf(loudness, 0.1, -40, 0.4)).toEqual([[0.5, 1]]);
  });

  it("puts the silence threshold well under a quiet recording's loud parts", () => {
    const quiet = Array.from({ length: 50 }, (_, i) => (i % 5 === 0 ? -80 : -38));
    expect(silenceThresholdOf(quiet)).toBe(-55);
    const loud = Array.from({ length: 50 }, (_, i) => (i % 5 === 0 ? -80 : -6));
    expect(silenceThresholdOf(loud)).toBe(-36);
  });
});
