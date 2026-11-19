import { describe, expect, it } from "vitest";
import { AudioFeatureStream, onsetStrength } from "./audioFeatures";
import { detectBeats, estimateTempo } from "./beats";

const RATE = 11025;

/** A steady, repeatable noise, so the tests hear the same thing every run. */
function noise(seed = 1) {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000 - 0.5;
  };
}

/** A metronome: a short burst of noise on every beat, from `first` seconds in. */
function clickTrack(bpm: number, seconds: number, first = 0.25) {
  const samples = new Float32Array(Math.round(seconds * RATE));
  const random = noise();
  const period = 60 / bpm;
  const clicks: number[] = [];
  for (let at = first; at < seconds - 0.05; at += period) {
    clicks.push(at);
    const start = Math.round(at * RATE);
    const length = Math.round(0.012 * RATE);
    for (let i = 0; i < length && start + i < samples.length; i++)
      samples[start + i] = 0.8 * random() * Math.exp(-i / (0.003 * RATE));
  }
  return { samples, clicks };
}

function measure(samples: Float32Array, chunk = 4096) {
  const stream = new AudioFeatureStream(RATE);
  for (let at = 0; at < samples.length; at += chunk) stream.push(samples.subarray(at, at + chunk));
  const features = stream.finish();
  return { ...features, strength: onsetStrength(features.envelope, features.envelopeRate) };
}

describe("the beat of a sound", () => {
  it("hears 120 BPM in a click track and puts a beat on every click", () => {
    const { samples, clicks } = clickTrack(120, 12);
    const { strength, envelopeRate } = measure(samples);
    const beats = detectBeats(strength, envelopeRate);
    expect(beats).not.toBeNull();
    expect(beats!.tempo).toBeGreaterThan(118);
    expect(beats!.tempo).toBeLessThan(122);
    expect(beats!.confidence).toBeGreaterThan(0.5);
    // Every beat is on a click, and nearly every click has its beat.
    for (const time of beats!.times) {
      const nearest = Math.min(...clicks.map((click) => Math.abs(click - time)));
      expect(nearest).toBeLessThan(0.03);
    }
    expect(beats!.times.length).toBeGreaterThanOrEqual(clicks.length - 2);
  });

  it("keeps a slower tempo rather than doubling or halving it", () => {
    const { samples } = clickTrack(90, 16, 0.1);
    const { strength, envelopeRate } = measure(samples);
    const tempo = estimateTempo(strength, envelopeRate);
    expect(tempo?.bpm).toBeGreaterThan(88);
    expect(tempo?.bpm).toBeLessThan(92);
    const beats = detectBeats(strength, envelopeRate);
    expect(beats?.tempo).toBeGreaterThan(88);
    expect(beats?.tempo).toBeLessThan(92);
  });

  it("finds no beat in silence or in steady noise", () => {
    const quiet = measure(new Float32Array(10 * RATE));
    expect(detectBeats(quiet.strength, quiet.envelopeRate)).toBeNull();
    const random = noise(7);
    const hiss = new Float32Array(10 * RATE).map(() => 0.3 * random());
    const noisy = measure(hiss);
    expect(detectBeats(noisy.strength, noisy.envelopeRate)).toBeNull();
  });

  it("measures the same however the sound arrives in chunks", () => {
    const { samples } = clickTrack(128, 6);
    const whole = measure(samples, samples.length);
    const pieces = measure(samples, 333);
    expect(pieces.envelope.length).toBe(whole.envelope.length);
    pieces.envelope.forEach((value, index) => expect(value).toBeCloseTo(whole.envelope[index], 4));
    expect(pieces.loudness).toEqual(whole.loudness);
  });

  it("is too short to have a tempo under a few beats long", () => {
    const { samples } = clickTrack(120, 1);
    const { strength, envelopeRate } = measure(samples);
    expect(estimateTempo(strength, envelopeRate)).toBeNull();
  });
});
