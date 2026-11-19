import type { MediaTime } from "@opencut/wasm";
import type { ScalarAnimationKey } from "@opencut/animation/types";
import type { SceneTracks, TimelineElement, TimelineTrack } from "@opencut/timeline";
import { VOLUME_DB_MAX, VOLUME_DB_MIN } from "@opencut/timeline/audio-constants";
import { buildElementFromMedia } from "@opencut/timeline/element-utils";
import { buildEmptyTrack } from "@opencut/timeline/placement/track-factory";
import { generateUUID } from "@opencut/utils/id";
import type { AudioAnalysis } from "../analysis/types";
import { sourceSpanOf } from "./beatCuts";
import { seconds, ticks } from "./projectModel";

/*
 * Music under a video, as plain data: a sound on an audio track of its own from the start to the
 * end of the picture, looped on whole bars when it is shorter, faded out at the end, and ducked
 * under the speech of the clips with sound. The level is the music's volume keyframes (OpenCut's
 * volume is keyframable, in dB, and both playback and export follow it), so it stays one clip
 * per loop that the person can still move, trim or re-level.
 */

/** The music's level where nobody speaks, in dB, unless asked otherwise. */
export const DEFAULT_MUSIC_DB = -8;
/** How far the music dips under speech, in dB. */
const DUCK_DB = 12;
/** How long the dip takes to come in before speech, and to go after it, in seconds. */
const ATTACK = 0.3;
const RELEASE = 0.6;
/** The fade out at the end, in seconds (shorter for a short video). */
const FADE_OUT = 2;
/** The dip at a loop's seam, so the join doesn't click: its half length and depth. */
const SEAM = 0.03;
const SEAM_DIP = 24;
/** The most loops of one sound, and the most dips under speech. */
const MAX_PIECES = 200;
const MAX_DUCKS = 150;

type Range = [number, number];
type Point = [number, number];

const fail = (message: string): never => {
  throw new Error(message);
};

const endOf = (element: TimelineElement) => element.startTime + element.duration;

/** Where the video's picture ends, in seconds: the last clip on the main or an overlay track. */
export function pictureEnd(tracks: SceneTracks): number {
  const ends = [tracks.main, ...tracks.overlay].flatMap((track) =>
    (track.elements as TimelineElement[]).map(endOf),
  );
  return seconds(ends.reduce((last, end) => Math.max(last, end), 0));
}

export interface MusicPiece {
  /** Where the piece starts on the timeline, and the stretch of the sound it plays (seconds). */
  start: number;
  sourceStart: number;
  sourceEnd: number;
}

/**
 * The pieces a sound is laid in to last `length` seconds: itself cut off at the end, or looped.
 * A sound with a beat loops on whole bars from its first beat, so the beat carries on across the
 * seam; one without loops whole.
 */
export function musicPieces(
  duration: number,
  length: number,
  beats: number[] | null,
): MusicPiece[] {
  if (!(duration > 0)) fail("This sound is empty.");
  if (duration >= length - 1e-3) return [{ start: 0, sourceStart: 0, sourceEnd: length }];
  let loopStart = 0;
  let loopEnd = duration;
  if (beats && beats.length >= 9) {
    const bars = Math.floor((beats.length - 1) / 4);
    const barEnd = beats[bars * 4];
    if (barEnd - beats[0] >= 2 && barEnd <= duration) {
      loopStart = beats[0];
      loopEnd = barEnd;
    }
  }
  const pieces: MusicPiece[] = [];
  let at = 0;
  let from = 0;
  while (length - at > 0.05) {
    if (pieces.length === MAX_PIECES)
      fail("This sound is too short to loop under the whole video.");
    const played = Math.min(loopEnd - from, length - at);
    pieces.push({ start: at, sourceStart: from, sourceEnd: from + played });
    at += played;
    from = loopStart;
  }
  return pieces;
}

/** Ranges in order, overlapping or close ones joined, so the music doesn't bob between words. */
export function duckRanges(sounds: Range[], length: number): Range[] {
  const clipped = sounds
    .map(([start, end]): Range => [Math.max(0, start), Math.min(length, end)])
    .filter(([start, end]) => end - start > 0.05)
    .sort((a, b) => a[0] - b[0]);
  let gap = ATTACK + RELEASE + 0.2;
  for (;;) {
    const joined: Range[] = [];
    for (const [start, end] of clipped) {
      const last = joined[joined.length - 1];
      if (last && start - last[1] < gap) last[1] = Math.max(last[1], end);
      else joined.push([start, end]);
    }
    const kept = joined.filter(([start, end]) => end - start >= 0.25);
    if (kept.length <= MAX_DUCKS) return kept;
    gap *= 1.5;
  }
}

/** A curve through points, holding its first and last values outside them. */
function valueAt(points: Point[], time: number): number {
  if (!points.length) return 0;
  if (time <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [t1, v1] = points[i];
    if (time <= t1) {
      const [t0, v0] = points[i - 1];
      return t1 === t0 ? v1 : v0 + ((v1 - v0) * (time - t0)) / (t1 - t0);
    }
  }
  return points[points.length - 1][1];
}

export interface MusicLevel {
  /** The music's level at a time on the timeline, in dB. */
  at(time: number): number;
  /** Every time the level changes direction, in order. */
  turns: number[];
}

/** The music's level over the video: its volume, dipped under speech and at seams, faded out. */
export function musicLevel(options: {
  length: number;
  volume: number;
  ducks: Range[];
  seams: number[];
}): MusicLevel {
  const { length, volume } = options;
  const dip = Math.max(VOLUME_DB_MIN, volume - DUCK_DB) - volume;
  const ducking = options.ducks.flatMap(([start, end]): Point[] => [
    [start - ATTACK, 0],
    [start, dip],
    [end, dip],
    [end + RELEASE, 0],
  ]);
  const fade = Math.min(FADE_OUT, length / 4);
  const fading: Point[] = [
    [length - fade, 0],
    [length, VOLUME_DB_MIN - volume],
  ];
  const seams = options.seams.flatMap((seam): Point[] => [
    [seam - SEAM, 0],
    [seam, -SEAM_DIP],
    [seam + SEAM, 0],
  ]);
  const curves = [ducking, fading, seams];
  const turns = [
    ...new Set([0, length, ...curves.flat().map(([time]) => time)].map((time) => ticks(time))),
  ]
    .map(seconds)
    .filter((time) => time >= 0 && time <= length)
    .sort((a, b) => a - b);
  return {
    at: (time) =>
      Math.min(
        VOLUME_DB_MAX,
        Math.max(
          VOLUME_DB_MIN,
          volume + curves.reduce((sum, curve) => sum + valueAt(curve, time), 0),
        ),
      ),
    turns,
  };
}

/** The volume keyframes of a piece playing from `start` to `end` on the timeline. */
export function levelKeys(level: MusicLevel, start: number, end: number): ScalarAnimationKey[] {
  const times = [start, ...level.turns.filter((time) => time > start && time < end), end];
  const points = times.map((time) => ({
    time: ticks(time - start),
    value: Math.round(level.at(time) * 100) / 100,
  }));
  // A key between two of the same level changes nothing.
  const kept = points.filter(
    (point, index) =>
      index === 0 ||
      index === points.length - 1 ||
      point.value !== points[index - 1].value ||
      point.value !== points[index + 1].value,
  );
  return kept.map((point): ScalarAnimationKey => ({
    id: generateUUID(),
    time: point.time as MediaTime,
    value: point.value,
    segmentToNext: "linear",
    tangentMode: "auto",
  }));
}

export interface MusicPlan {
  /** The sound's media asset in the project, its name and its length in seconds. */
  mediaId: string;
  name: string;
  duration: number;
  /** Its beat times (seconds in the sound), to loop on whole bars. */
  beats: number[] | null;
  /** Its level in dB where nobody speaks. */
  volume: number;
  /** When there is speech to duck under, on the timeline. */
  speech: Range[];
}

/** The tracks with the music laid under the picture on an audio track of its own. */
export function layMusic(tracks: SceneTracks, plan: MusicPlan): SceneTracks {
  const length = pictureEnd(tracks);
  if (length <= 0) fail("This video has nothing to put music under yet.");
  const volume = Math.min(VOLUME_DB_MAX, Math.max(VOLUME_DB_MIN, plan.volume));
  const pieces = musicPieces(plan.duration, length, plan.beats);
  const level = musicLevel({
    length,
    volume,
    ducks: duckRanges(plan.speech, length),
    seams: pieces.slice(1).map((piece) => piece.start),
  });
  const whole = ticks(plan.duration);
  const elements = pieces.map((piece) => {
    const end = piece.start + (piece.sourceEnd - piece.sourceStart);
    // Each piece starts on the tick the one before ends.
    const startTime = ticks(piece.start);
    const duration = ticks(end) - startTime;
    const built = buildElementFromMedia({
      mediaId: plan.mediaId,
      mediaType: "audio",
      name: plan.name,
      duration: duration as MediaTime,
      startTime: startTime as MediaTime,
    });
    const trimStart = Math.min(whole, ticks(piece.sourceStart));
    return {
      ...built,
      id: generateUUID(),
      trimStart: trimStart as MediaTime,
      trimEnd: Math.max(0, whole - trimStart - duration) as MediaTime,
      sourceDuration: whole as MediaTime,
      params: { ...built.params, volume: Math.round(volume * 100) / 100 },
      animations: { volume: { keys: levelKeys(level, piece.start, end) } },
    } as TimelineElement;
  });
  const track = {
    ...buildEmptyTrack({ id: generateUUID(), type: "audio", name: "Music" }),
    elements,
  } as TimelineTrack;
  return { ...tracks, audio: [...tracks.audio, track] as SceneTracks["audio"] };
}

/** A clip whose sound plays, and the analysis of that sound. */
export interface SoundingClip {
  element: TimelineElement;
  audio: AudioAnalysis;
}

/** When the clips' sound is not silent, as ranges on the timeline. */
export function soundRanges(clips: SoundingClip[]): Range[] {
  return clips.flatMap(({ element, audio }) => {
    const { start, end, sourceStart, sourceEnd, rate } = sourceSpanOf(element);
    const toTimeline = (time: number) => start + (time - sourceStart) / (rate || 1);
    const ranges: Range[] = [];
    let from = sourceStart;
    for (const [quietStart, quietEnd] of audio.silences) {
      if (quietEnd <= from) continue;
      if (quietStart >= sourceEnd) break;
      if (quietStart > from) ranges.push([from, quietStart]);
      from = Math.max(from, quietEnd);
    }
    if (from < sourceEnd) ranges.push([from, sourceEnd]);
    return ranges.map(([a, b]): Range => [
      Math.max(start, toTimeline(a)),
      Math.min(end, toTimeline(b)),
    ]);
  });
}

/** What the speech under music needs to know about a clip's media. */
export interface SoundSource {
  hasSound: boolean;
  analyse(): Promise<AudioAnalysis | null>;
}

const isMuted = (element: TimelineElement) => element.params?.muted === true;

/**
 * When something is said (or anything heard) in the video, from the clips with sound: videos
 * playing their own sound, and sounds on audio tracks that have no beat (a voice, not music).
 */
export async function speechIn(
  tracks: SceneTracks,
  sourceOf: (mediaId: string) => SoundSource | undefined,
): Promise<Range[]> {
  const candidates: Array<{ element: TimelineElement; mediaId: string; music: boolean }> = [];
  for (const track of [tracks.main, ...tracks.overlay])
    if (track.type === "video" && !track.muted)
      for (const element of track.elements)
        if (element.type === "video" && element.isSourceAudioEnabled !== false && !isMuted(element))
          candidates.push({ element, mediaId: element.mediaId, music: false });
  for (const track of tracks.audio)
    if (!track.muted)
      for (const element of track.elements)
        if (element.sourceType === "upload" && !isMuted(element))
          candidates.push({ element, mediaId: element.mediaId, music: true });
  const analyses = new Map<string, Promise<AudioAnalysis | null>>();
  const clips: SoundingClip[] = [];
  for (const { element, mediaId, music } of candidates) {
    const source = sourceOf(mediaId);
    if (!source?.hasSound) continue;
    if (!analyses.has(mediaId))
      analyses.set(
        mediaId,
        source.analyse().catch(() => null),
      );
    const audio = await analyses.get(mediaId);
    // A sound with a beat on an audio track is music already, not speech.
    if (!audio || (music && audio.beats)) continue;
    clips.push({ element, audio });
  }
  return soundRanges(clips);
}
