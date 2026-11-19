import type { MediaTime } from "@opencut/wasm";
import type {
  GraphicElement,
  SceneTracks,
  TimelineElement,
  TimelineTrack,
} from "@opencut/timeline";
import { buildGraphicElement } from "@opencut/timeline/element-utils";
import { buildEmptyTrack } from "@opencut/timeline/placement/track-factory";
import { generateUUID } from "@opencut/utils/id";
import { MOTION_GRAPHIC_ID, isMotionGraphic, readMotionScript } from "@opencut/motion/definition";
import { MAX_SCRIPT_CHARS } from "@opencut/motion/limits";
import { MOTION_PRESET_IDS, getMotionPreset } from "@opencut/motion/presets";
import {
  mergeMotionProps,
  motionPropValues,
  readMotionProps,
  serializeMotionProps,
  type MotionProps,
} from "@opencut/motion/props";
import { loadMotionRuntime, testMotionScript } from "@opencut/motion/runtime";
import type { DocumentEditHandler } from "./documentEdits";
import { allTracks, copyDocument, projectOf, sceneOf, seconds, ticks } from "./projectModel";

/*
 * Motion graphics for agents: a graphic drawn by a draw(ctx, t, props) script, run sandboxed
 * (vendor/opencut/src/motion). `graphic` adds one from a script or a preset; `set_graphic`
 * changes one's script or props. Either refuses a script that doesn't draw, with its error.
 */

export type GraphicEdit = {
  op: "graphic";
  /** A draw(ctx, t, props) script, or */
  script?: string;
  /** one of the starter graphics (MOTION_PRESET_IDS). */
  preset?: string;
  /** Declarations ({ type, value, ... }) or, for a preset's props, bare values. */
  props?: Record<string, unknown>;
  start: number;
  end: number;
  /** Pixels from the frame's center to move the whole graphic by. */
  position?: { x: number; y: number };
  name?: string;
};

export type SetGraphicEdit = {
  op: "set_graphic";
  element_id: string;
  script?: string;
  /** Declarations replace or add props, bare values set them, null removes one. */
  props?: Record<string, unknown>;
};

export { MOTION_PRESET_IDS };

const fail = (message: string): never => {
  throw new Error(message);
};

const endOf = (element: TimelineElement) => element.startTime + element.duration;

/** Puts a graphic on the first graphic track it fits on, or a new one above the rest. */
function placeGraphic(tracks: SceneTracks, element: TimelineElement): SceneTracks {
  const fits = (track: TimelineTrack) =>
    track.type === "graphic" &&
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
  const track = {
    ...buildEmptyTrack({ id: generateUUID(), type: "graphic" }),
    elements: [element],
  };
  return { ...tracks, overlay: [track, ...tracks.overlay] as SceneTracks["overlay"] };
}

/** Refuses a script that is too long, doesn't compile, defines no draw or throws as it draws. */
async function checkScript(
  script: unknown,
  props: MotionProps,
  canvas: { width: number; height: number },
  duration: number,
): Promise<string> {
  if (typeof script !== "string" || !script.trim()) return fail("The graphic's script is empty.");
  if (script.length > MAX_SCRIPT_CHARS)
    fail(
      `The script is ${script.length} characters long; a motion graphic's script can be at most ${MAX_SCRIPT_CHARS}.`,
    );
  await loadMotionRuntime();
  const error = testMotionScript({
    script,
    props: motionPropValues(props),
    duration,
    width: canvas.width,
    height: canvas.height,
  });
  if (error) fail(`The graphic's script doesn't draw. ${error}`);
  return script;
}

function positionParams(position: GraphicEdit["position"]) {
  if (position === undefined) return {};
  if (
    !position ||
    typeof position !== "object" ||
    !Number.isFinite(position.x) ||
    !Number.isFinite(position.y)
  )
    return fail("position is { x, y } in pixels from the frame's center.");
  return {
    "transform.positionX": Math.round(position.x),
    "transform.positionY": Math.round(position.y),
  };
}

/** `graphic`: a motion graphic from a script or a preset, from start to end (seconds). */
export const addMotionGraphic: DocumentEditHandler<GraphicEdit> = async (document, edit) => {
  const next = copyDocument(document);
  const project = projectOf(next);
  const scene = sceneOf(project);
  if (
    !Number.isFinite(edit.start) ||
    !Number.isFinite(edit.end) ||
    edit.start < 0 ||
    !(edit.end > edit.start)
  )
    fail("The graphic needs a start before its end.");
  if (edit.script !== undefined && edit.preset !== undefined)
    fail("A graphic takes a script or a preset, not both.");
  const presets = MOTION_PRESET_IDS.join(", ");
  const preset =
    edit.preset === undefined
      ? undefined
      : (getMotionPreset(edit.preset) ??
        fail(`There is no preset ${edit.preset}; the presets are ${presets}.`));
  const props = mergeMotionProps(preset?.props ?? {}, edit.props);
  const script = await checkScript(
    preset?.script ??
      edit.script ??
      fail(`A graphic needs a script, or one of the presets: ${presets}.`),
    props,
    project.settings.canvasSize,
    edit.end - edit.start,
  );
  const name =
    typeof edit.name === "string" && edit.name.trim()
      ? edit.name.trim().slice(0, 60)
      : (preset?.name ?? "Motion graphic");
  const element = {
    ...buildGraphicElement({
      definitionId: MOTION_GRAPHIC_ID,
      name,
      startTime: ticks(edit.start) as MediaTime,
      params: { script, props: serializeMotionProps(props), ...positionParams(edit.position) },
    }),
    id: generateUUID(),
    duration: ticks(edit.end - edit.start) as MediaTime,
  } as TimelineElement;
  scene.tracks = placeGraphic(scene.tracks, element);
  return next;
};

/** `set_graphic`: a motion graphic's script, props or both, changed. */
export const setMotionGraphic: DocumentEditHandler<SetGraphicEdit> = async (document, edit) => {
  const next = copyDocument(document);
  const project = projectOf(next);
  const scene = sceneOf(project);
  if (edit.script === undefined && edit.props === undefined)
    fail("set_graphic changes a graphic's script, its props or both.");
  const element =
    allTracks(scene.tracks)
      .flatMap((track) => track.elements as TimelineElement[])
      .find((each) => each.id === edit.element_id) ??
    fail(`There is no clip ${edit.element_id} in this video; video_read lists them.`);
  if (!isMotionGraphic(element))
    fail(`${edit.element_id} isn't a motion graphic; the graphic edit adds one.`);
  const graphic = element as GraphicElement;
  const props = mergeMotionProps(readMotionProps(graphic.params.props), edit.props);
  const script = await checkScript(
    edit.script ?? readMotionScript(graphic.params),
    props,
    project.settings.canvasSize,
    seconds(graphic.duration),
  );
  graphic.params = { ...graphic.params, script, props: serializeMotionProps(props) };
  return next;
};

/** What video_read shows of a motion graphic: its props as declared and its script. */
export function describeMotionGraphic(
  element: TimelineElement,
): { props: MotionProps; script: string } | undefined {
  if (!isMotionGraphic(element)) return undefined;
  const { params } = element as GraphicElement;
  return { props: readMotionProps(params.props), script: readMotionScript(params) };
}
