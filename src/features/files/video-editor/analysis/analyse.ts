import { LOUDNESS_STEP, onsetStrength, silenceThresholdOf, silencesOf } from "./audioFeatures";
import { detectBeats } from "./beats";
import { footageKey, keep, readKept } from "./cache";
import { measureAudio, stopIfAborted, VideoReader } from "./decode";
import { canLabelPictures, labelPicture } from "./labels";
import {
  belongsToNext,
  findCuts,
  frameDistance,
  scenesBetween,
  type FrameFeatures,
} from "./scenes";
import type { AudioAnalysis, FootageAnalysis, FootageScene, VisualAnalysis } from "./types";

/*
 * A media file's analysis, done in the webview the first time it is asked for and kept on this
 * computer after (`cache.ts`). Its picture and its sound are analysed and kept apart, so what
 * needs only the sound (beats, ducking) never waits on the picture.
 */

/** Frames are compared at most this often, and at most this many per file. */
const MIN_INTERVAL = 0.25;
const MAX_FRAMES = 1200;
/** How many times a cut found between two samples is narrowed down, and for how many cuts. */
const REFINE_STEPS = 3;
const MAX_REFINED = 150;
/** The most scenes given labels: the longest ones. */
const MAX_LABELLED = 40;

const round = (value: number, places = 3) => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};

const SOUND_EXTENSION = /\.(mp3|wav|wave|m4a|aac|ogg|oga|opus|flac|aif|aiff|caf|weba)$/i;

/** Whether a file is only sound, by its type or its name. */
export function isSoundFile(file: File): boolean {
  return file.type.startsWith("audio/") || SOUND_EXTENSION.test(file.name);
}

export interface AnalyseOptions {
  /** Whether to analyse the picture too; the sound alone otherwise. */
  visual?: boolean;
  signal?: AbortSignal;
}

const running = new Map<string, Promise<unknown>>();

/** A part of the analysis, from what is kept or worked out once however many ask at a time. */
async function part<T>(key: string, work: () => Promise<T>): Promise<T> {
  const kept = await readKept<T>(key);
  if (kept) return kept.value;
  const pending = running.get(key) as Promise<T> | undefined;
  if (pending) return pending;
  const started = work().then(async (value) => {
    await keep(key, value);
    return value;
  });
  running.set(key, started);
  try {
    return await started;
  } finally {
    running.delete(key);
  }
}

async function analyseSound(file: File, signal?: AbortSignal): Promise<AudioAnalysis | null> {
  const features = await measureAudio(file, signal);
  if (!features || features.duration <= 0) return null;
  const strength = onsetStrength(features.envelope, features.envelopeRate);
  const silenceThreshold = silenceThresholdOf(features.loudness);
  return {
    duration: round(features.duration),
    step: LOUDNESS_STEP,
    loudness: features.loudness.map((db) => round(db, 1)),
    silenceThreshold: round(silenceThreshold, 1),
    silences: silencesOf(features.loudness, LOUDNESS_STEP, silenceThreshold).map(
      ([start, end]) => [round(start, 2), round(end, 2)] as [number, number],
    ),
    beats: detectBeats(strength, features.envelopeRate),
  };
}

interface Sample {
  time: number;
  features: FrameFeatures;
}

async function sampleFrames(reader: VideoReader, times: number[], signal?: AbortSignal) {
  const samples: Sample[] = [];
  let index = 0;
  for await (const features of reader.framesAt(times)) {
    stopIfAborted(signal);
    if (features) samples.push({ time: times[index], features });
    index++;
  }
  return samples;
}

/**
 * Each cut's time narrowed down between the last sample before it and the first after: the
 * frame between them is read and the cut moves to whichever side it belongs.
 */
async function refineCuts(
  reader: VideoReader,
  samples: Sample[],
  cuts: number[],
  signal?: AbortSignal,
): Promise<number[]> {
  const spans = cuts.map((cut) => ({ before: samples[cut - 1], after: samples[cut] }));
  const refined = spans.slice(0, MAX_REFINED);
  for (let step = 0; step < REFINE_STEPS; step++) {
    const open = refined.filter(({ before, after }) => after.time - before.time > 0.06);
    if (!open.length) break;
    const times = open.map(({ before, after }) => round((before.time + after.time) / 2));
    let index = 0;
    for await (const features of reader.framesAt(times)) {
      stopIfAborted(signal);
      const span = open[index];
      const time = times[index++];
      if (!features) continue;
      if (belongsToNext(span.before.features, features, span.after.features))
        span.after = { time, features };
      else span.before = { time, features };
    }
  }
  return spans.map(({ after }) => round(after.time));
}

/** Labels for the longest scenes, from a picture in the middle of each. */
async function labelScenes(reader: VideoReader, scenes: FootageScene[], signal?: AbortSignal) {
  const chosen = [...scenes]
    .sort((a, b) => b.end - b.start - (a.end - a.start))
    .slice(0, MAX_LABELLED)
    .sort((a, b) => a.start - b.start);
  const times = chosen.map((scene) => round((scene.start + scene.end) / 2));
  let index = 0;
  for await (const picture of reader.picturesAt(times)) {
    stopIfAborted(signal);
    const scene = chosen[index++];
    if (!picture) continue;
    const labels = await labelPicture(picture);
    if (labels.length) scene.labels = labels;
  }
}

async function analysePicture(file: File, signal?: AbortSignal): Promise<VisualAnalysis | null> {
  const reader = await VideoReader.open(file);
  if (!reader) return null;
  try {
    const { duration } = reader;
    const interval = Math.max(MIN_INTERVAL, duration / MAX_FRAMES);
    const times: number[] = [];
    for (let at = 0; at < duration && times.length < MAX_FRAMES; at += interval)
      times.push(round(at));
    const samples = await sampleFrames(reader, times, signal);
    if (!samples.length) return null;
    const distances = samples.map((sample, index) =>
      index === 0 ? 0 : frameDistance(samples[index - 1].features, sample.features),
    );
    const cuts = findCuts(
      samples.map((sample) => sample.time),
      distances,
    );
    const cutTimes = await refineCuts(reader, samples, cuts, signal);
    const scenes = scenesBetween(
      cutTimes,
      duration,
      samples.map((sample) => ({ time: sample.time, color: sample.features.color })),
    ).map((scene) => ({
      start: round(scene.start),
      end: round(scene.end),
      brightness: round(scene.brightness),
      contrast: round(scene.contrast),
      warmth: round(scene.warmth),
      tint: round(scene.tint),
      saturation: round(scene.saturation),
    }));
    const labelled = await canLabelPictures();
    if (labelled) await labelScenes(reader, scenes, signal);
    return {
      duration: round(duration),
      width: reader.width,
      height: reader.height,
      sampledEvery: round(interval),
      labelled,
      scenes,
    };
  } finally {
    reader.close();
  }
}

/**
 * The analysis of a media file: its sound always, and its picture when asked for. Each part is
 * worked out once per computer; the rest of the time it is read back.
 */
export async function analyseFootage(
  file: File,
  options: AnalyseOptions = {},
): Promise<FootageAnalysis> {
  const key = await footageKey(file);
  // A file that can't be read has nothing to tell, unless the asker stopped waiting.
  const nothing = (error: unknown) => {
    if (options.signal?.aborted) throw error;
    return null;
  };
  const audio = await part(`${key}:audio`, () => analyseSound(file, options.signal)).catch(nothing);
  const visual =
    options.visual && !isSoundFile(file)
      ? await part(`${key}:visual`, () => analysePicture(file, options.signal)).catch(nothing)
      : null;
  return {
    duration: Math.max(audio?.duration ?? 0, visual?.duration ?? 0),
    visual,
    audio,
  };
}
