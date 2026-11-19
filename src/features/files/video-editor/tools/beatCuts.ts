// Shortening a clip follows OpenCut's SplitElementsCommand (vendor/opencut/src/commands/timeline/
// element/split-elements.ts, MIT) as edits.ts does: the source span is rounded once and the trim
// derives from it, so `trimStart + span + trimEnd` still adds up to the source.
import { roundFrameTicks, roundMediaTime, type MediaTime } from "@opencut/wasm";
import { splitAnimationsAtTime } from "@opencut/animation";
import { getSourceSpanAtClipTime, getTimelineDurationForSourceSpan } from "@opencut/retime";
import type { SerializedProject } from "@opencut/services/storage/types";
import type { SceneTracks, TimelineElement, TimelineTrack } from "@opencut/timeline";
import { isRetimableElement } from "@opencut/timeline";
import { seconds, ticks } from "./projectModel";

/*
 * Cutting a video to a beat, as plain data: the main track's cut points move to the nearest
 * beats. Each clip keeps its first frame and only its length changes (shorter, or longer into
 * source it had trimmed off), so the clips stay end to end with no gap or overlap. Everything
 * on the other tracks moves with the clip it starts over, except the tracks the beat comes from.
 */

type FrameRate = SerializedProject["settings"]["fps"];

/** The shortest clip a cut may leave, in seconds. */
const MIN_CLIP = 0.2;

const fail = (message: string): never => {
  throw new Error(message);
};

const endOf = (element: TimelineElement) => element.startTime + element.duration;
const retimeOf = (element: TimelineElement) =>
  isRetimableElement(element) ? element.retime : undefined;
/** Whether a clip plays a stretch of a media file (not a photo, a title or a graphic). */
const playsSource = (element: TimelineElement) =>
  element.type === "video" || element.type === "audio";

/** A clip's place on the timeline and the stretch of its source it plays, in seconds. */
export function sourceSpanOf(element: TimelineElement) {
  const start = seconds(element.startTime);
  const end = seconds(endOf(element));
  const sourceStart = seconds(element.trimStart);
  const span = seconds(
    getSourceSpanAtClipTime({ clipTime: element.duration, retime: retimeOf(element) }),
  );
  return {
    start,
    end,
    sourceStart,
    sourceEnd: sourceStart + span,
    rate: span / (end - start || 1),
  };
}

/** Beat times in an audio clip's source, as the times on the timeline where the clip plays them. */
export function beatsOnTimeline(element: TimelineElement, beats: number[]): number[] {
  const retime = retimeOf(element);
  const from = element.trimStart;
  const to = from + getSourceSpanAtClipTime({ clipTime: element.duration, retime });
  return beats
    .map(ticks)
    .filter((beat) => beat >= from && beat <= to)
    .map((beat) =>
      seconds(
        element.startTime + getTimelineDurationForSourceSpan({ sourceSpan: beat - from, retime }),
      ),
    );
}

/** The longest a clip can be from its first frame, in ticks: as far as its source goes. */
export function longestLength(element: TimelineElement): number {
  if (!playsSource(element)) return Infinity;
  const retime = retimeOf(element);
  const room = getSourceSpanAtClipTime({ clipTime: element.duration, retime }) + element.trimEnd;
  return Math.floor(getTimelineDurationForSourceSpan({ sourceSpan: room, retime }));
}

/** A clip made `length` ticks long from the same first frame. */
export function withLength(element: TimelineElement, length: number): TimelineElement {
  if (length === element.duration) return element;
  const retime = retimeOf(element);
  const span = (time: number) =>
    roundMediaTime({ time: getSourceSpanAtClipTime({ clipTime: time, retime }) });
  const animations =
    length < element.duration
      ? splitAnimationsAtTime({
          animations: element.animations,
          splitTime: length as MediaTime,
          shouldIncludeSplitBoundary: true,
        }).leftAnimations
      : element.animations;
  const trimEnd = playsSource(element)
    ? Math.max(0, element.trimEnd + span(element.duration) - span(length))
    : element.trimEnd;
  return {
    ...element,
    duration: length as MediaTime,
    trimEnd: trimEnd as MediaTime,
    animations,
  } as TimelineElement;
}

export interface BeatCutOptions {
  /** Cut on every beat (1), every other (2) or once a bar (4). */
  every: number;
  fps: FrameRate;
  /** Tracks that stay where they are: the ones the beat comes from. */
  anchored?: ReadonlySet<string>;
}

interface Shift {
  from: number;
  to: number;
  by: number;
}

/** Moves a track's clips with the main-track clip each starts over, then clears any overlap. */
function followShifts<T extends TimelineTrack>(track: T, shifts: Shift[]): T {
  const shiftAt = (time: number) => {
    const inside = shifts.find((shift) => time >= shift.from && time < shift.to);
    if (inside) return inside.by;
    return time < shifts[0].from ? 0 : shifts[shifts.length - 1].by;
  };
  const moved = (track.elements as TimelineElement[])
    .map(
      (element) =>
        ({
          ...element,
          startTime: Math.max(0, element.startTime + shiftAt(element.startTime)) as MediaTime,
        }) as TimelineElement,
    )
    .sort((a, b) => a.startTime - b.startTime);
  const shortest = ticks(0.05);
  const placed: TimelineElement[] = [];
  for (const element of moved) {
    const previous = placed[placed.length - 1];
    if (previous && endOf(previous) > element.startTime) {
      const room = element.startTime - previous.startTime;
      if (room >= shortest) placed[placed.length - 1] = withLength(previous, room);
      else {
        placed.push({ ...element, startTime: endOf(previous) as MediaTime } as TimelineElement);
        continue;
      }
    }
    placed.push(element);
  }
  return { ...track, elements: placed } as T;
}

/**
 * The tracks with the main track's cuts on the beats (`beats`: seconds on the timeline, in
 * order). Each cut goes to the beat nearest where it would fall, among those the clip before
 * can reach; a cut with no beat in reach stays where it falls.
 */
export function cutToBeatTimes(
  tracks: SceneTracks,
  beats: number[],
  options: BeatCutOptions,
): SceneTracks {
  const clips = [...tracks.main.elements].sort((a, b) => a.startTime - b.startTime);
  if (clips.length < 2)
    fail("Cutting to the beat needs at least two clips on the main track; split it first.");
  const every = Math.max(1, Math.round(options.every));
  const grid = [...new Set(beats.filter((_, index) => index % every === 0).map(ticks))]
    .map((beat) => roundFrameTicks({ ticks: beat, fps: options.fps }))
    .sort((a, b) => a - b);
  if (grid.length < 2) fail("There are too few beats under this video to cut to.");
  const shortest = ticks(MIN_CLIP);
  const shifts: Shift[] = [];
  let at: number = clips[0].startTime;
  const main = clips.map((clip) => {
    const longest = longestLength(clip);
    const natural = at + clip.duration;
    let end = natural;
    let nearest = Infinity;
    for (const beat of grid) {
      if (beat < at + shortest || beat > at + longest) continue;
      const distance = Math.abs(beat - natural);
      if (distance < nearest) {
        nearest = distance;
        end = beat;
      }
    }
    const length = Math.max(1, Math.min(end - at, longest));
    shifts.push({ from: clip.startTime, to: endOf(clip), by: at - clip.startTime });
    const placed = { ...withLength(clip, length), startTime: at as MediaTime } as TimelineElement;
    at += length;
    return placed;
  });
  const follow = <T extends TimelineTrack>(track: T): T =>
    options.anchored?.has(track.id) ? track : followShifts(track, shifts);
  return {
    main: { ...tracks.main, elements: main as SceneTracks["main"]["elements"] },
    overlay: tracks.overlay.map(follow),
    audio: tracks.audio.map(follow),
  };
}
