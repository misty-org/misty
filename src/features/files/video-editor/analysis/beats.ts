import type { BeatAnalysis } from "./types";

/*
 * Tempo and beat times from an onset envelope. The tempo is the autocorrelation's strongest lag
 * between 60 and 200 BPM, weighted toward 120 BPM; the beats follow Ellis's dynamic programming
 * beat tracker ("Beat Tracking by Dynamic Programming", 2007): each beat is placed where onsets
 * are strong and about one beat period after the one before.
 */

const MIN_BPM = 60;
const MAX_BPM = 200;
/** Where the tempo weighting peaks, and its spread in octaves. */
const PREFERRED_BPM = 120;
const SPREAD_OCTAVES = 1;
/** How strongly beats keep to the period. */
const TIGHTNESS = 100;
/** The most of the envelope read for the tempo, in seconds. */
const TEMPO_WINDOW = 180;
/** Under this, a sound has no steady beat. */
export const MIN_BEAT_CONFIDENCE = 0.1;

export interface Tempo {
  /** The beat period, in envelope frames. */
  period: number;
  bpm: number;
  confidence: number;
}

/** The sound's tempo, or null when the envelope is too short or flat to have one. */
export function estimateTempo(strength: Float32Array, rate: number): Tempo | null {
  const length = Math.min(strength.length, Math.round(rate * TEMPO_WINDOW));
  const shortest = Math.max(1, Math.floor((60 * rate) / MAX_BPM));
  const longest = Math.ceil((60 * rate) / MIN_BPM);
  if (length < longest * 3) return null;
  // Correlated about its mean, so a steady wash of onsets (noise, applause) has no beat.
  let mean = 0;
  for (let i = 0; i < length; i++) mean += strength[i];
  mean /= length;
  const correlation = (lag: number) => {
    let sum = 0;
    for (let i = 0; i + lag < length; i++) sum += (strength[i] - mean) * (strength[i + lag] - mean);
    return sum / (length - lag);
  };
  const energy = correlation(0);
  if (!(energy > 0)) return null;
  const values = new Float64Array(longest + 2);
  for (let lag = Math.max(1, shortest - 1); lag <= longest + 1; lag++)
    values[lag] = correlation(lag);
  let best = -1;
  let bestScore = -Infinity;
  for (let lag = shortest; lag <= longest; lag++) {
    const bpm = (60 * rate) / lag;
    const octaves = Math.log2(bpm / PREFERRED_BPM) / SPREAD_OCTAVES;
    const score = values[lag] * Math.exp(-0.5 * octaves * octaves);
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  if (best < 0) return null;
  // The true period sits between frames: a parabola through the peak and its neighbours.
  const [before, peak, after] = [values[best - 1], values[best], values[best + 1]];
  const bend = before - 2 * peak + after;
  const shift = bend < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (before - after)) / bend)) : 0;
  const period = best + shift;
  return {
    period,
    bpm: (60 * rate) / period,
    confidence: Math.max(0, Math.min(1, peak / energy)),
  };
}

/** The envelope smoothed with a Gaussian a small part of a beat wide. */
function localScore(strength: Float32Array, period: number): Float32Array {
  const radius = Math.max(1, Math.ceil(period / 8));
  const kernel = Array.from({ length: radius * 2 + 1 }, (_, index) => {
    const t = ((index - radius) * 32) / period;
    return Math.exp(-0.5 * t * t);
  });
  const out = new Float32Array(strength.length);
  for (let i = 0; i < strength.length; i++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) {
      const at = i + k;
      if (at >= 0 && at < strength.length) sum += strength[at] * kernel[k + radius];
    }
    out[i] = sum;
  }
  return out;
}

/** Beat frames: the best chain of onsets about `period` frames apart. */
export function trackBeats(strength: Float32Array, period: number): number[] {
  const n = strength.length;
  if (n === 0 || !(period > 1)) return [];
  const score = localScore(strength, period);
  const earliest = Math.round(2 * period);
  const latest = Math.max(1, Math.round(period / 2));
  const penalty = new Float64Array(earliest + 1);
  for (let gap = latest; gap <= earliest; gap++) {
    const ratio = Math.log(gap / period);
    penalty[gap] = -TIGHTNESS * ratio * ratio;
  }
  const total = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    let best = -Infinity;
    let from = -1;
    for (let gap = latest; gap <= earliest && gap <= i; gap++) {
      const candidate = total[i - gap] + penalty[gap];
      if (candidate > best) {
        best = candidate;
        from = i - gap;
      }
    }
    // A beat with nothing good before it starts a chain of its own.
    if (from >= 0 && best > 0) {
      total[i] = score[i] + best;
      back[i] = from;
    } else total[i] = score[i];
  }
  // The chain ends at the best total in the last beat's worth of frames.
  let end = n - 1;
  for (let i = Math.max(0, n - Math.round(period)); i < n; i++) if (total[i] > total[end]) end = i;
  const beats: number[] = [];
  for (let at = end; at >= 0; at = back[at]) beats.push(at);
  beats.reverse();
  // Beats where there is no sound at the start or end are dropped.
  let squares = 0;
  for (const beat of beats) squares += score[beat] * score[beat];
  const floor = 0.5 * Math.sqrt(squares / Math.max(1, beats.length));
  let first = 0;
  let last = beats.length - 1;
  while (first <= last && score[beats[first]] < floor) first++;
  while (last >= first && score[beats[last]] < floor) last--;
  return beats.slice(first, last + 1);
}

/** The sound's beat from its onset strength (`onsetStrength`), or null with no steady one. */
export function detectBeats(strength: Float32Array, rate: number): BeatAnalysis | null {
  const tempo = estimateTempo(strength, rate);
  if (!tempo || tempo.confidence < MIN_BEAT_CONFIDENCE) return null;
  const frames = trackBeats(strength, tempo.period);
  if (frames.length < 4) return null;
  const times = frames.map((frame) => Math.round((frame / rate) * 1000) / 1000);
  // The tempo the beats keep, from the middle of their gaps.
  const gaps = times
    .slice(1)
    .map((time, index) => time - times[index])
    .sort((a, b) => a - b);
  const gap = gaps[Math.floor(gaps.length / 2)];
  const bpm = gap > 0 ? 60 / gap : tempo.bpm;
  return {
    tempo: Math.round(bpm * 10) / 10,
    confidence: Math.round(tempo.confidence * 100) / 100,
    times,
  };
}
