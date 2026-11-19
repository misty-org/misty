import { clampAnimationsToDuration } from "@opencut/animation";
import { DEFAULT_TRANSITION_SECONDS, TRANSITION_KINDS } from "@opencut/look/transitions";
import { getBuiltInElementParams } from "@opencut/params/registry";
import { getSourceSpanAtClipTime, getTimelineDurationForSourceSpan } from "@opencut/retime";
import { clampRetimeRate } from "@opencut/retime/rate";
import type { SceneTracks, TimelineElement, TimelineTrack } from "@opencut/timeline";
import { isRetimableElement } from "@opencut/timeline";
import { replaceElementSource } from "@opencut/timeline/replace-source";
import { roundMediaTime, type MediaTime } from "@opencut/wasm";
import type { VideoProjectDocument } from "../projectDocumentTypes";
import type { DocumentEditHandler } from "./documentEdits";
import { registerMedia } from "./addMedia";
import { splitElement } from "./splitElement";
import { allTracks, projectOf, sceneOf, seconds, ticks } from "./projectModel";

/*
 * Edits to one or two clips that change their media, speed or transitions: `replace_source`,
 * `speed_ramp` and `transition`. Each returns a new document and leaves the one given as it was.
 */

/**
 * Swaps a clip's media for another Media item (the cleaned voice, the upscaled shot) at the same
 * place and timing, keeping its trim, params, effects, keyframes and speed. When the new item is
 * shorter than the stretch of it the clip plays, the clip ends where the item ends and the main
 * track closes up behind it. A kind it can't take (a sound into a video clip) is refused.
 */
export type ReplaceSourceEdit = { op: "replace_source"; element_id: string; item_id: string };

/**
 * Changes a clip's speed gradually from `from` to `to` over [start, end) (seconds on the
 * video's timeline, the whole clip when left out). OpenCut plays each clip at one speed, so the
 * stretch becomes `steps` clips in a row, each a little faster or slower than the last. What
 * follows on the clip's track moves with its new length.
 */
export type SpeedRampEdit = {
  op: "speed_ramp";
  element_id: string;
  from: number;
  to: number;
  start?: number;
  end?: number;
  steps?: number;
};

/** A transition between two clips: the first goes out and the second comes in the same way. */
export type TransitionEdit = {
  op: "transition";
  element_ids: string[];
  kind: string;
  seconds?: number;
};

export const DEFAULT_RAMP_STEPS = 8;
export const MAX_RAMP_STEPS = 24;
/** The shortest stretch a ramp works over, and the shortest piece of one (a frame at 30fps). */
const MIN_RAMP_SECONDS = 0.1;
const MIN_PIECE_SECONDS = 1 / 30;

const fail = (message: string): never => {
  throw new Error(message);
};

const endOf = (element: TimelineElement) => element.startTime + element.duration;

function findClip(tracks: SceneTracks, id: string) {
  for (const track of allTracks(tracks)) {
    const element = (track.elements as TimelineElement[]).find((candidate) => candidate.id === id);
    if (element) return { track, element };
  }
  return fail(`There is no clip ${id} in this video; video_read lists them.`);
}

/** The document with the shown scene's tracks swapped for `tracks`, its other parts shared. */
function withTracks(document: VideoProjectDocument, tracks: SceneTracks): VideoProjectDocument {
  const project = projectOf(document);
  const scene = sceneOf(project);
  return {
    ...document,
    project: {
      ...project,
      scenes: project.scenes.map((each) => (each.id === scene.id ? { ...each, tracks } : each)),
    },
  };
}

/** Each track with `change` applied to the one with id `trackId`. */
function mapTrack(
  tracks: SceneTracks,
  trackId: string,
  change: (elements: TimelineElement[]) => TimelineElement[],
): SceneTracks {
  const apply = <T extends TimelineTrack>(track: T): T =>
    track.id === trackId
      ? ({ ...track, elements: change(track.elements as TimelineElement[]) } as T)
      : track;
  return {
    main: apply(tracks.main),
    overlay: tracks.overlay.map(apply),
    audio: tracks.audio.map(apply),
  };
}

export const replaceSource: DocumentEditHandler<ReplaceSourceEdit> = async (
  document,
  edit,
  { loadMedia },
) => {
  if (typeof edit.element_id !== "string" || typeof edit.item_id !== "string")
    fail("replace_source takes the clip's element_id and the Media item_id to put in it.");
  findClip(sceneOf(projectOf(document)).tracks, edit.element_id);
  const registered = await registerMedia(document, edit.item_id, loadMedia);
  const { media } = registered;
  const replaced = replaceElementSource({
    tracks: sceneOf(projectOf(registered.document)).tracks,
    elementId: edit.element_id,
    media: {
      assetId: media.assetId,
      type: media.type,
      name: media.name,
      duration: media.duration,
      hasAudio: media.hasAudio,
    },
  });
  return withTracks(registered.document, replaced.tracks);
};

const smooth = (t: number) => t * t * (3 - 2 * t);

/** The speeds of a ramp's pieces, easing from `from` to `to`, first and last exactly those. */
export function rampRates(from: number, to: number, steps: number): number[] {
  return Array.from({ length: steps }, (_, index) =>
    clampRetimeRate({
      rate: steps === 1 ? to : from + (to - from) * smooth(index / (steps - 1)),
    }),
  );
}

/** A piece of a clip at a new speed, the same stretch of its source played faster or slower. */
function atRate(piece: TimelineElement, rate: number): TimelineElement {
  if (!isRetimableElement(piece)) return piece;
  const span = getSourceSpanAtClipTime({ clipTime: piece.duration, retime: piece.retime });
  const retime = { ...piece.retime, rate };
  const duration = Math.max(
    1,
    roundMediaTime({ time: getTimelineDurationForSourceSpan({ sourceSpan: span, retime }) }),
  ) as MediaTime;
  return {
    ...piece,
    retime,
    duration,
    animations: clampAnimationsToDuration({ animations: piece.animations, duration }),
  } as TimelineElement;
}

export const speedRamp: DocumentEditHandler<SpeedRampEdit> = async (document, edit) => {
  const speeds = [edit.from, edit.to];
  if (!speeds.every((speed) => typeof speed === "number" && Number.isFinite(speed) && speed > 0))
    fail("from and to are speeds above 0, such as 0.5 for half speed or 2 for double.");
  const steps = edit.steps ?? DEFAULT_RAMP_STEPS;
  if (!Number.isInteger(steps) || steps < 2 || steps > MAX_RAMP_STEPS)
    fail(`steps is a whole number from 2 to ${MAX_RAMP_STEPS}.`);
  const tracks = sceneOf(projectOf(document)).tracks;
  const { track, element } = findClip(tracks, edit.element_id);
  if (!isRetimableElement(element))
    fail(`Only video and sound clips have a speed; ${edit.element_id} is ${element.type}.`);
  const clipStart = element.startTime;
  const clipEnd = endOf(element);
  const within = (value: number | undefined, fallback: number) =>
    value === undefined ? fallback : Math.min(clipEnd, Math.max(clipStart, ticks(value)));
  const a = within(edit.start, clipStart);
  const b = within(edit.end, clipEnd);
  if (b - a < ticks(MIN_RAMP_SECONDS))
    fail(
      `The ramp needs at least ${MIN_RAMP_SECONDS}s inside the clip, which runs from ${seconds(clipStart)}s to ${seconds(clipEnd)}s.`,
    );

  // The clip before the ramp, the ramp, and the clip after it.
  let rest = element;
  let head: TimelineElement | null = null;
  if (a > clipStart) [head, rest] = splitElement(rest, a);
  let tail: TimelineElement | null = null;
  if (b < clipEnd) [rest, tail] = splitElement(rest, b);
  const count = Math.max(2, Math.min(steps, Math.floor((b - a) / ticks(MIN_PIECE_SECONDS))));
  const parts: TimelineElement[] = [];
  for (let index = 1; index < count; index++) {
    const [left, right] = splitElement(rest, a + Math.round((index * (b - a)) / count));
    parts.push(left);
    rest = right;
  }
  parts.push(rest);

  const rates = rampRates(edit.from, edit.to, parts.length);
  let at = a;
  const ramped = parts.map((part, index) => {
    const placed = { ...atRate(part, rates[index]), startTime: at as MediaTime } as TimelineElement;
    at += placed.duration;
    return placed;
  });
  const pieces = [
    ...(head ? [head] : []),
    ...ramped,
    ...(tail ? [{ ...tail, startTime: at as MediaTime } as TimelineElement] : []),
  ];
  const moved = (tail ? at + tail.duration : at) - clipEnd;
  return withTracks(
    document,
    mapTrack(tracks, track.id, (elements) =>
      elements.flatMap((other) => {
        if (other.id === element.id) return pieces;
        if (other.startTime >= clipEnd)
          return [{ ...other, startTime: Math.max(0, other.startTime + moved) } as TimelineElement];
        return [other];
      }),
    ),
  );
};

const transitionKinds = new Set<string>(TRANSITION_KINDS.map((kind) => kind.value));

function takesTransitions(element: TimelineElement): boolean {
  return getBuiltInElementParams({ type: element.type }).some(
    (param) => param.key === "transition.in",
  );
}

export const transition: DocumentEditHandler<TransitionEdit> = async (document, edit) => {
  const ids = edit.element_ids;
  if (!Array.isArray(ids) || ids.length !== 2 || ids[0] === ids[1])
    fail("transition takes element_ids of two clips: the one going out, then the one coming in.");
  if (!transitionKinds.has(edit.kind)) fail(`kind is one of ${[...transitionKinds].join(", ")}.`);
  if (
    edit.seconds !== undefined &&
    (typeof edit.seconds !== "number" || !Number.isFinite(edit.seconds) || edit.seconds <= 0)
  )
    fail("seconds is how long the transition lasts, above 0.");
  const tracks = sceneOf(projectOf(document)).tracks;
  const [out, into] = ids.map((id) => findClip(tracks, id).element);
  for (const element of [out, into])
    if (!takesTransitions(element))
      fail(`Only clips that are seen have transitions; ${element.id} is ${element.type}.`);
  // Each side lasts as asked, within what a transition may last and the clip's own length.
  const lasting = (element: TimelineElement) =>
    Math.min(
      5,
      seconds(element.duration),
      Math.max(0.05, edit.seconds ?? DEFAULT_TRANSITION_SECONDS),
    );
  const change = (element: TimelineElement): TimelineElement => {
    if (element.id === out.id)
      return {
        ...element,
        params: {
          ...element.params,
          "transition.out": edit.kind,
          "transition.outDuration": lasting(element),
        },
      } as TimelineElement;
    if (element.id === into.id)
      return {
        ...element,
        params: {
          ...element.params,
          "transition.in": edit.kind,
          "transition.inDuration": lasting(element),
        },
      } as TimelineElement;
    return element;
  };
  const changeAll = <T extends TimelineTrack>(track: T): T =>
    ({ ...track, elements: (track.elements as TimelineElement[]).map(change) }) as T;
  return withTracks(document, {
    main: changeAll(tracks.main),
    overlay: tracks.overlay.map(changeAll),
    audio: tracks.audio.map(changeAll),
  });
};
