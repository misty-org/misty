/**
 * What Misty knows about one media file from looking at and listening to it on this computer:
 * its shots and their look, and its sound's loudness and beat. Times are seconds in the file.
 */

/** How a stretch of picture looks, each from its frames' pixels. */
export interface FootageColor {
  /** Mean luma, 0 (black) to 1 (white). */
  brightness: number;
  /** Spread of luma (its standard deviation), 0 to 0.5. */
  contrast: number;
  /** Red over blue, -1 (cold) to 1 (warm). */
  warmth: number;
  /** Green over magenta, -1 (magenta) to 1 (green). */
  tint: number;
  /** Mean chroma, 0 (gray) to 1. */
  saturation: number;
}

export interface FootageLabel {
  label: string;
  confidence: number;
}

/** One shot, from one cut to the next. */
export interface FootageScene extends FootageColor {
  start: number;
  end: number;
  /** What the computer's image classifier sees in it; left out where it has none. */
  labels?: FootageLabel[];
}

export interface VisualAnalysis {
  duration: number;
  width: number;
  height: number;
  /** How far apart the frames compared for cuts were, in seconds. */
  sampledEvery: number;
  /** Whether the scenes were labelled (the computer has an image classifier). */
  labelled: boolean;
  scenes: FootageScene[];
}

export interface BeatAnalysis {
  /** Beats per minute. */
  tempo: number;
  /** How regular the beat is, 0 (none) to 1 (a metronome). */
  confidence: number;
  times: number[];
}

export interface AudioAnalysis {
  duration: number;
  /** The loudness readings' spacing, in seconds. */
  step: number;
  /** RMS level of each step, in dB below full scale. */
  loudness: number[];
  /** The level under which a stretch counts as silent, in dB. */
  silenceThreshold: number;
  /** Silent stretches of at least a few tenths of a second, as [start, end]. */
  silences: Array<[number, number]>;
  /** The beat, or null where the sound has no steady one. */
  beats: BeatAnalysis | null;
}

export interface FootageAnalysis {
  duration: number;
  /** The picture's analysis; null for a sound, or a video this computer can't decode. */
  visual: VisualAnalysis | null;
  /** The sound's analysis; null for a video with no sound. */
  audio: AudioAnalysis | null;
}
