import { Spectrum } from "./spectrum";

/*
 * What is measured of a sound as it is decoded, a chunk at a time, so a long file never sits in
 * memory whole: its loudness at a fixed step, and an onset envelope (spectral flux) for its beat.
 */

/** The spacing of loudness readings, in seconds. */
export const LOUDNESS_STEP = 0.1;
/** The quietest level reported, in dB below full scale. */
export const FLOOR_DB = -90;
/** Samples in one spectrum frame, and between frames. */
const FRAME = 512;
const HOP = 128;

export interface AudioFeatures {
  sampleRate: number;
  /** Seconds of sound measured. */
  duration: number;
  /** RMS dB of each LOUDNESS_STEP. */
  loudness: number[];
  /** Spectral flux per frame, each frame centred HOP samples after the last. */
  envelope: Float32Array;
  /** Frames per second of the envelope. */
  envelopeRate: number;
}

/** A growable list of floats. */
class Floats {
  private data = new Float32Array(4096);
  length = 0;
  push(value: number) {
    if (this.length === this.data.length) {
      const grown = new Float32Array(this.data.length * 2);
      grown.set(this.data);
      this.data = grown;
    }
    this.data[this.length++] = value;
  }
  done(): Float32Array {
    return this.data.slice(0, this.length);
  }
}

export class AudioFeatureStream {
  private readonly spectrum = new Spectrum(FRAME);
  private readonly block: number;
  private sumSquares = 0;
  private inBlock = 0;
  private samples = 0;
  private readonly loudness: number[] = [];
  private readonly envelope = new Floats();
  // Frames are centred on their time: the first one starts half a frame before the sound.
  private readonly pending = new Float32Array(FRAME * 4);
  private filled = FRAME / 2;
  private readonly frame = new Float32Array(FRAME);
  private current = new Float32Array(FRAME / 2 + 1);
  private previous = new Float32Array(FRAME / 2 + 1);

  constructor(readonly sampleRate: number) {
    this.block = Math.max(1, Math.round(LOUDNESS_STEP * sampleRate));
  }

  /** Measures the next stretch of mono samples. */
  push(chunk: Float32Array): void {
    for (let i = 0; i < chunk.length; i++) {
      const sample = chunk[i];
      this.sumSquares += sample * sample;
      if (++this.inBlock === this.block) this.endBlock();
    }
    this.samples += chunk.length;
    let offset = 0;
    while (offset < chunk.length) {
      const take = Math.min(this.pending.length - this.filled, chunk.length - offset);
      this.pending.set(chunk.subarray(offset, offset + take), this.filled);
      this.filled += take;
      offset += take;
      this.drain();
    }
  }

  /** What was measured; the stream is spent after it. */
  finish(): AudioFeatures {
    if (this.inBlock >= this.block / 2) this.endBlock();
    // The last frames are centred on the sound's last samples too.
    const tail = new Float32Array(FRAME / 2);
    this.pending.set(tail, this.filled);
    this.filled += tail.length;
    this.drain();
    return {
      sampleRate: this.sampleRate,
      duration: this.samples / this.sampleRate,
      loudness: this.loudness,
      envelope: this.envelope.done(),
      envelopeRate: this.sampleRate / HOP,
    };
  }

  private endBlock() {
    const mean = this.sumSquares / Math.max(1, this.inBlock);
    this.loudness.push(Math.max(FLOOR_DB, 10 * Math.log10(mean + 1e-12)));
    this.sumSquares = 0;
    this.inBlock = 0;
  }

  private drain() {
    let start = 0;
    while (this.filled - start >= FRAME) {
      this.frame.set(this.pending.subarray(start, start + FRAME));
      this.envelope.push(this.flux());
      start += HOP;
    }
    this.pending.copyWithin(0, start, this.filled);
    this.filled -= start;
  }

  /** How much the log spectrum rose since the last frame, summed over its bins. */
  private flux(): number {
    this.spectrum.magnitudes(this.frame, this.current);
    let rise = 0;
    for (let k = 0; k < this.current.length; k++) {
      const level = Math.log1p((100 * this.current[k]) / (FRAME / 4));
      this.current[k] = level;
      const step = level - this.previous[k];
      if (step > 0) rise += step;
    }
    [this.current, this.previous] = [this.previous, this.current];
    return rise;
  }
}

/** The level under which a stretch is silent: well under the sound's loud parts. */
export function silenceThresholdOf(loudness: number[]): number {
  if (loudness.length === 0) return -50;
  const sorted = [...loudness].sort((a, b) => a - b);
  const loud = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  return Math.min(-30, Math.max(-55, loud - 30));
}

/** Stretches at least `minimum` seconds long that stay under `threshold`, as [start, end]. */
export function silencesOf(
  loudness: number[],
  step: number,
  threshold: number,
  minimum = 0.4,
): Array<[number, number]> {
  const found: Array<[number, number]> = [];
  let from = -1;
  for (let i = 0; i <= loudness.length; i++) {
    const quiet = i < loudness.length && loudness[i] < threshold;
    if (quiet && from < 0) from = i;
    if (!quiet && from >= 0) {
      if ((i - from) * step >= minimum - 1e-9) found.push([from * step, i * step]);
      from = -1;
    }
  }
  return found;
}

/**
 * The envelope as onset strength: with its slow swell taken out, only rises kept, and scaled to
 * unit spread, so its peaks are where notes and hits start.
 */
export function onsetStrength(envelope: Float32Array, rate: number): Float32Array {
  const radius = Math.max(1, Math.round(rate * 0.1));
  const out = new Float32Array(envelope.length);
  let sum = 0;
  let from = 0;
  let to = -1;
  for (let i = 0; i < envelope.length; i++) {
    while (to < Math.min(envelope.length - 1, i + radius)) sum += envelope[++to];
    while (from < i - radius) sum -= envelope[from++];
    const mean = sum / (to - from + 1);
    out[i] = Math.max(0, envelope[i] - mean);
  }
  let squares = 0;
  for (const value of out) squares += value * value;
  const spread = Math.sqrt(squares / Math.max(1, out.length));
  if (spread > 0) for (let i = 0; i < out.length; i++) out[i] /= spread;
  return out;
}
