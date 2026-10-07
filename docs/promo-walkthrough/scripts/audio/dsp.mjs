// Small deterministic DSP toolkit: seeded noise, wavetable sines, a Freeverb
// style reverb, filters and a 32-bit float WAV writer.
import { writeFile } from "node:fs/promises";

export const RATE = 48_000;

export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TABLE = 8192;
const sineTable = new Float32Array(TABLE + 1).map((_, i) => Math.sin((2 * Math.PI * i) / TABLE));
/** Sine of a phase measured in cycles. */
export function sin(phase) {
  const x = (phase - Math.floor(phase)) * TABLE;
  const i = x | 0;
  return sineTable[i] + (sineTable[i + 1] - sineTable[i]) * (x - i);
}

export const midi = (note) => 440 * Math.pow(2, (note - 69) / 12);
export const db = (value) => Math.pow(10, value / 20);

export function stereo(seconds) {
  const length = Math.round(seconds * RATE);
  return { left: new Float32Array(length), right: new Float32Array(length), length };
}

/** One-pole low-pass, in place. */
export function lowpass(data, cutoff) {
  const k = 1 - Math.exp((-2 * Math.PI * cutoff) / RATE);
  let y = 0;
  for (let i = 0; i < data.length; i++) data[i] = y += k * (data[i] - y);
}
export function highpass(data, cutoff) {
  const k = 1 - Math.exp((-2 * Math.PI * cutoff) / RATE);
  let y = 0;
  for (let i = 0; i < data.length; i++) {
    y += k * (data[i] - y);
    data[i] -= y;
  }
}

function comb(size, feedback, damp) {
  const buffer = new Float32Array(size);
  let index = 0;
  let store = 0;
  return (input) => {
    const out = buffer[index];
    store = out * (1 - damp) + store * damp;
    buffer[index] = input + store * feedback;
    index = (index + 1) % size;
    return out;
  };
}
function allpass(size) {
  const buffer = new Float32Array(size);
  let index = 0;
  return (input) => {
    const delayed = buffer[index];
    buffer[index] = input + delayed * 0.5;
    index = (index + 1) % size;
    return delayed - input;
  };
}

/** Freeverb tunings scaled to 48 kHz; returns wet-only stereo. */
export function reverb(bus, { room = 0.84, damp = 0.4, spread = 23 } = {}) {
  const scale = RATE / 44_100;
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const passes = [556, 441, 341, 225];
  const make = (offset) => ({
    combs: combs.map((size) => comb(Math.round((size + offset) * scale), room, damp)),
    passes: passes.map((size) => allpass(Math.round((size + offset) * scale))),
  });
  const channels = [make(0), make(spread)];
  const out = stereo(bus.length / RATE);
  for (let i = 0; i < bus.length; i++) {
    const input = (bus.left[i] + bus.right[i]) * 0.015;
    channels.forEach((channel, c) => {
      let sum = 0;
      for (const filter of channel.combs) sum += filter(input);
      for (const filter of channel.passes) sum = filter(sum);
      (c ? out.right : out.left)[i] = sum;
    });
  }
  return out;
}

export function addInto(target, source, gain = 1, offset = 0) {
  for (let i = 0; i < source.length && i + offset < target.length; i++) {
    target.left[i + offset] += source.left[i] * gain;
    target.right[i + offset] += source.right[i] * gain;
  }
}

export async function writeWav(path, { left, right, length }) {
  const header = Buffer.alloc(44);
  const bytes = length * 8;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + bytes, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(3, 20); // IEEE float
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 8, 28);
  header.writeUInt16LE(8, 32);
  header.writeUInt16LE(32, 34);
  header.write("data", 36);
  header.writeUInt32LE(bytes, 40);
  const body = Buffer.alloc(bytes);
  for (let i = 0; i < length; i++) {
    body.writeFloatLE(left[i], i * 8);
    body.writeFloatLE(right[i], i * 8 + 4);
  }
  await writeFile(path, Buffer.concat([header, body]));
}
