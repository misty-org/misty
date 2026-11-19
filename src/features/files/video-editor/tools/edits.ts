import type { MediaTime } from "@opencut/wasm";
import { getSourceSpanAtClipTime } from "@opencut/retime";
import { clampRetimeRate } from "@opencut/retime/rate";
import { getBuiltInElementParams } from "@opencut/params/registry";
import type { SceneTracks, TimelineElement, TimelineTrack } from "@opencut/timeline";
import { isRetimableElement } from "@opencut/timeline";
import { buildTextElement } from "@opencut/timeline/element-utils";
import { buildEmptyTrack } from "@opencut/timeline/placement/track-factory";
import { generateUUID } from "@opencut/utils/id";
import type { VideoProjectDocument } from "../projectDocumentTypes";
import type { EditContext } from "./documentEdits";
import { splitElement } from "./splitElement";
import { allTracks, copyDocument, durationOf, projectOf, sceneOf, ticks } from "./projectModel";
import { addMedia, type AddOperation } from "./addMedia";
import {
  addCaptionTrack,
  restyleCaptions,
  type CaptionsEdit,
  type CaptionsStyleEdit,
} from "./captions";
import {
  replaceSource,
  speedRamp,
  transition,
  type ReplaceSourceEdit,
  type SpeedRampEdit,
  type TransitionEdit,
} from "./clipEdits";
import {
  addMotionGraphic,
  setMotionGraphic,
  type GraphicEdit,
  type SetGraphicEdit,
} from "./motionEdits";
import { addMusic, cutToBeats, type AddMusicEdit, type CutToBeatsEdit } from "./beatEdits";

export type VideoEdit =
  | { op: "cut"; ranges: Array<{ start: number; end: number }> }
  | { op: "split"; at: number; element_ids?: string[] }
  | { op: "delete"; element_ids: string[] }
  | { op: "order"; element_ids: string[] }
  | { op: "move"; element_id: string; start: number }
  | { op: "set"; element_ids: string[]; params?: Record<string, unknown>; speed?: number }
  | { op: "text"; text: string; start: number; end: number; position?: "top" | "center" | "bottom" }
  | CaptionsEdit
  | CaptionsStyleEdit
  | ReplaceSourceEdit
  | SpeedRampEdit
  | TransitionEdit
  | GraphicEdit
  | SetGraphicEdit
  | CutToBeatsEdit
  | AddMusicEdit
  | AddOperation
  | { op: "frame"; aspect: keyof typeof FRAMES };

export const FRAMES = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
  "4:3": { width: 1440, height: 1080 },
  "21:9": { width: 2560, height: 1080 },
} as const;

const fail = (message: string): never => {
  throw new Error(message);
};

const endOf = (element: TimelineElement) => element.startTime + element.duration;

/** Removes [a, b) from every track, closing the gap: what comes after moves back by its length. */
function cutRange(tracks: SceneTracks, a: number, b: number): SceneTracks {
  const cutTrack = <T extends TimelineTrack>(track: T): T => {
    const elements = (track.elements as TimelineElement[]).flatMap((element) => {
      let pieces = [element];
      for (const at of [a, b])
        pieces = pieces.flatMap((piece) =>
          at > piece.startTime && at < endOf(piece) ? splitElement(piece, at) : [piece],
        );
      return pieces
        .filter((piece) => !(piece.startTime >= a && endOf(piece) <= b))
        .map((piece) =>
          piece.startTime >= b
            ? ({ ...piece, startTime: piece.startTime - (b - a) } as TimelineElement)
            : piece,
        );
    });
    return { ...track, elements } as T;
  };
  return {
    main: cutTrack(tracks.main),
    overlay: tracks.overlay.map(cutTrack),
    audio: tracks.audio.map(cutTrack),
  };
}

/** Lays the main track's clips end to end from the start, in the order given. */
function pack<T extends TimelineElement>(elements: T[]): T[] {
  let at = 0;
  return elements.map((element) => {
    const placed = { ...element, startTime: at as MediaTime } as T;
    at += element.duration;
    return placed;
  });
}

function findElement(tracks: SceneTracks, id: string) {
  for (const track of allTracks(tracks)) {
    const element = (track.elements as TimelineElement[]).find((candidate) => candidate.id === id);
    if (element) return { track, element };
  }
  return fail(`There is no clip ${id} in this video; video_read lists them.`);
}

function mapElements(
  tracks: SceneTracks,
  change: (element: TimelineElement, track: TimelineTrack) => TimelineElement | null,
): SceneTracks {
  const mapTrack = <T extends TimelineTrack>(track: T): T =>
    ({
      ...track,
      elements: (track.elements as TimelineElement[]).flatMap(
        (element) => change(element, track) ?? [],
      ),
    }) as T;
  return {
    main: mapTrack(tracks.main),
    overlay: tracks.overlay.map(mapTrack),
    audio: tracks.audio.map(mapTrack),
  };
}

/** A param value as the editor allows it for this kind of clip, or an error saying why not. */
function checkedParam(element: TimelineElement, key: string, value: unknown): unknown {
  const param = getBuiltInElementParams({ type: element.type }).find((each) => each.key === key);
  if (!param) return fail(`A ${element.type} clip has no ${key}.`);
  if (param.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return fail(`${key} takes a number.`);
    return Math.min(param.max ?? Infinity, Math.max(param.min, value));
  }
  if (param.type === "boolean")
    return typeof value === "boolean" ? value : fail(`${key} takes true or false.`);
  if (param.type === "select")
    return param.options.some((option) => option.value === value)
      ? value
      : fail(`${key} takes one of ${param.options.map((option) => option.value).join(", ")}.`);
  return typeof value === "string" ? value : fail(`${key} takes text.`);
}

/** Puts a clip on the first text track it fits on, or a new one above the rest. */
function placeText(tracks: SceneTracks, element: TimelineElement): SceneTracks {
  const fits = (track: TimelineTrack) =>
    track.type === "text" &&
    (track.elements as TimelineElement[]).every(
      (other) => endOf(other) <= element.startTime || other.startTime >= endOf(element),
    );
  const index = tracks.overlay.findIndex(fits);
  if (index >= 0)
    return {
      ...tracks,
      overlay: tracks.overlay.map((track, at) =>
        at === index
          ? ({ ...track, elements: [...track.elements, element] } as TimelineTrack)
          : track,
      ) as SceneTracks["overlay"],
    };
  const track = { ...buildEmptyTrack({ id: generateUUID(), type: "text" }), elements: [element] };
  return { ...tracks, overlay: [track, ...tracks.overlay] as SceneTracks["overlay"] };
}

function applyEdit(
  edit: VideoEdit,
  tracks: SceneTracks,
  canvas: { width: number; height: number },
): SceneTracks {
  switch (edit.op) {
    case "cut": {
      const ranges = [...edit.ranges].sort((x, y) => y.start - x.start);
      return ranges.reduce((current, range) => {
        if (!(range.end > range.start) || range.start < 0)
          fail("Each range needs a start before its end.");
        return cutRange(current, ticks(range.start), ticks(range.end));
      }, tracks);
    }
    case "split": {
      const at = ticks(edit.at);
      const only = edit.element_ids ? new Set(edit.element_ids) : null;
      const splitTrack = <T extends TimelineTrack>(track: T): T =>
        ({
          ...track,
          elements: (track.elements as TimelineElement[]).flatMap((element) =>
            (!only || only.has(element.id)) && at > element.startTime && at < endOf(element)
              ? splitElement(element, at)
              : [element],
          ),
        }) as T;
      return {
        main: splitTrack(tracks.main),
        overlay: tracks.overlay.map(splitTrack),
        audio: tracks.audio.map(splitTrack),
      };
    }
    case "delete": {
      const ids = new Set(edit.element_ids);
      edit.element_ids.forEach((id) => findElement(tracks, id));
      const kept = mapElements(tracks, (element) => (ids.has(element.id) ? null : element));
      return { ...kept, main: { ...kept.main, elements: pack(kept.main.elements) } };
    }
    case "order": {
      const byId = new Map(tracks.main.elements.map((element) => [element.id, element]));
      const ordered = edit.element_ids.map(
        (id) => byId.get(id) ?? fail(`${id} isn't on the main track.`),
      );
      const rest = tracks.main.elements.filter((element) => !edit.element_ids.includes(element.id));
      return { ...tracks, main: { ...tracks.main, elements: pack([...ordered, ...rest]) } };
    }
    case "move": {
      const { track } = findElement(tracks, edit.element_id);
      if (track.id === tracks.main.id)
        fail("Clips on the main track follow each other; use order to rearrange them.");
      return mapElements(tracks, (element) =>
        element.id === edit.element_id
          ? ({ ...element, startTime: ticks(Math.max(0, edit.start)) } as TimelineElement)
          : element,
      );
    }
    case "set": {
      edit.element_ids.forEach((id) => findElement(tracks, id));
      const ids = new Set(edit.element_ids);
      const changed = mapElements(tracks, (element) => {
        if (!ids.has(element.id)) return element;
        let next = element;
        if (edit.params) {
          const params = { ...element.params };
          for (const [key, value] of Object.entries(edit.params))
            params[key] = checkedParam(element, key, value) as never;
          next = { ...next, params } as TimelineElement;
        }
        if (edit.speed !== undefined) {
          if (!isRetimableElement(next)) fail(`A ${next.type} clip has no speed.`);
          const rate = clampRetimeRate({ rate: edit.speed });
          const span = getSourceSpanAtClipTime({
            clipTime: next.duration,
            retime: isRetimableElement(next) ? next.retime : undefined,
          });
          next = {
            ...next,
            retime: { rate },
            duration: Math.max(1, Math.round(span / rate)) as MediaTime,
          } as TimelineElement;
        }
        return next;
      });
      return { ...changed, main: { ...changed.main, elements: pack(changed.main.elements) } };
    }
    case "text": {
      if (!(edit.end > edit.start)) fail("The text needs a start before its end.");
      const offset = edit.position === "top" ? -0.35 : edit.position === "bottom" ? 0.35 : 0;
      const element = {
        ...buildTextElement({
          raw: {
            name: edit.text.slice(0, 40),
            duration: ticks(edit.end - edit.start) as MediaTime,
            params: {
              content: edit.text,
              "transform.positionY": Math.round(canvas.height * offset),
            },
          },
          startTime: ticks(edit.start) as MediaTime,
        }),
        id: generateUUID(),
      } as TimelineElement;
      return placeText(tracks, element);
    }
    case "captions":
      return addCaptionTrack(tracks, edit, canvas);
    case "frame":
      return tracks;
    case "add":
    case "captions_style":
    case "replace_source":
    case "speed_ramp":
    case "transition":
    case "graphic":
    case "set_graphic":
    case "cut_to_beats":
    case "add_music":
      return fail(`${edit.op} runs on the whole video`);
    default:
      return fail(`There is no edit ${(edit as { op: string }).op}.`);
  }
}

/** The edits that work on the whole document (they read media or several tracks), bound to their input. */
function wholeVideoEdit(
  edit: VideoEdit,
):
  ((document: VideoProjectDocument, context: EditContext) => Promise<VideoProjectDocument>) | null {
  switch (edit.op) {
    case "captions_style":
      return (document, context) => restyleCaptions(document, edit, context);
    case "replace_source":
      return (document, context) => replaceSource(document, edit, context);
    case "speed_ramp":
      return (document, context) => speedRamp(document, edit, context);
    case "transition":
      return (document, context) => transition(document, edit, context);
    case "graphic":
      return (document, context) => addMotionGraphic(document, edit, context);
    case "set_graphic":
      return (document, context) => setMotionGraphic(document, edit, context);
    case "cut_to_beats":
      return (document, context) => cutToBeats(document, edit, context);
    case "add_music":
      return (document, context) => addMusic(document, edit, context);
    default:
      return null;
  }
}

/**
 * Applies edits in order to a copy of a project and returns it, its clock moved on so it is the
 * newest everywhere. Nothing is kept until the caller keeps the result.
 */
export async function editVideoProject(
  document: VideoProjectDocument,
  edits: VideoEdit[],
  loadMedia: (itemId: string) => Promise<File>,
): Promise<VideoProjectDocument> {
  const context: EditContext = { loadMedia };
  let next = copyDocument(document);
  for (const edit of edits) {
    if (edit.op === "add") {
      next = await addMedia(next, edit, loadMedia);
      continue;
    }
    const whole = wholeVideoEdit(edit);
    if (whole) {
      next = await whole(next, context);
      continue;
    }
    const project = projectOf(next);
    if (edit.op === "frame") {
      const size =
        FRAMES[edit.aspect] ?? fail(`The frame is one of ${Object.keys(FRAMES).join(", ")}.`);
      project.settings = { ...project.settings, canvasSize: { ...size }, canvasSizeMode: "preset" };
      continue;
    }
    const scene = sceneOf(project);
    scene.tracks = applyEdit(edit, scene.tracks, project.settings.canvasSize);
  }
  if (next.project !== null) {
    const project = projectOf(next);
    project.metadata = {
      ...project.metadata,
      duration: durationOf(sceneOf(project).tracks) as MediaTime,
      updatedAt: new Date().toISOString(),
    };
  }
  return next;
}
