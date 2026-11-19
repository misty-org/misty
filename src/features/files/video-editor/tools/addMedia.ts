import type { MediaTime } from "@opencut/wasm";
import { mediaTimeFromSeconds } from "@opencut/wasm";
import { processMediaAssets } from "@opencut/media/processing";
import type { SerializedProject } from "@opencut/services/storage/types";
import { CURRENT_PROJECT_VERSION } from "@opencut/services/storage/migrations";
import type { SceneTracks, TimelineElement, TimelineTrack } from "@opencut/timeline";
import { buildElementFromMedia } from "@opencut/timeline/element-utils";
import { DEFAULT_NEW_ELEMENT_DURATION } from "@opencut/timeline/creation";
import { buildEmptyTrack } from "@opencut/timeline/placement/track-factory";
import { buildDefaultScene } from "@opencut/timeline/scenes";
import { DEFAULT_CANVAS_SIZE } from "@opencut/canvas/sizes";
import { DEFAULT_FPS } from "@opencut/fps/defaults";
import { DEFAULT_BACKGROUND_COLOR } from "@opencut/background/color";
import { generateUUID } from "@opencut/utils/id";
import type { VideoProjectDocument, VideoProjectMedia } from "../projectDocumentTypes";
import { durationOf, projectOf, sceneOf, ticks } from "./projectModel";

/** Puts one of the Space's media items in the video: on the main track, over it, or under it. */
export type AddOperation = {
  op: "add";
  item_id: string;
  /** Where it starts, in seconds; on the main track it goes in there and what follows moves on. */
  start?: number;
  /** For a photo, when it ends (photos last 5 seconds otherwise); for media, where it is cut off. */
  end?: number;
  track?: "main" | "overlay" | "audio";
};

/** A project for a video that had nothing in it yet, made as OpenCut makes a new one. */
function newProject(name: string): SerializedProject {
  const scene = buildDefaultScene({ name: "Main scene", isMain: true });
  const now = new Date().toISOString();
  return {
    metadata: {
      id: generateUUID(),
      name,
      duration: 0 as MediaTime,
      createdAt: now,
      updatedAt: now,
    },
    scenes: [{ ...scene, createdAt: now, updatedAt: now }],
    currentSceneId: scene.id,
    settings: {
      fps: DEFAULT_FPS,
      canvasSize: { ...DEFAULT_CANVAS_SIZE },
      canvasSizeMode: "preset",
      lastCustomCanvasSize: null,
      originalCanvasSize: null,
      background: { type: "color", color: DEFAULT_BACKGROUND_COLOR },
    },
    version: CURRENT_PROJECT_VERSION,
  } as SerializedProject;
}

function insertOnMain(tracks: SceneTracks, element: TimelineElement, at: number): SceneTracks {
  const before = tracks.main.elements.filter((other) => other.startTime < at);
  const after = tracks.main.elements.filter((other) => other.startTime >= at);
  const start = before.reduce((end, other) => Math.max(end, other.startTime + other.duration), 0);
  const placed = { ...element, startTime: start as MediaTime } as TimelineElement;
  const moved = after.map((other) => ({
    ...other,
    startTime: (other.startTime + element.duration) as MediaTime,
  }));
  return {
    ...tracks,
    main: {
      ...tracks.main,
      elements: [...before, placed, ...moved] as typeof tracks.main.elements,
    },
  };
}

/** A Media item read and probed as the editor probes an import, and listed in the project. */
export interface RegisteredMedia {
  document: VideoProjectDocument;
  /** The project's entry for it: the asset id its clips point at, and what was probed. */
  media: VideoProjectMedia;
  file: File;
}

/**
 * Reads one of the Space's Media items, probes it as the editor does when media is imported, and
 * lists it in the project's media unless it is there already (then its asset id is kept, so
 * every clip of it shares one asset). The document is copied, not changed.
 */
export async function registerMedia(
  document: VideoProjectDocument,
  itemId: string,
  loadMedia: (itemId: string) => Promise<File>,
): Promise<RegisteredMedia> {
  const file = await loadMedia(itemId);
  const [probed] = await processMediaAssets({ files: [file] });
  if (!probed) throw new Error(`“${file.name}” can't be used in a video.`);
  const known = document.media.find((media) => media.itemId === itemId);
  const media: VideoProjectMedia = {
    assetId: known?.assetId ?? generateUUID(),
    itemId,
    name: probed.name,
    type: probed.type,
    ...(probed.width !== undefined && { width: probed.width }),
    ...(probed.height !== undefined && { height: probed.height }),
    ...(probed.duration !== undefined && { duration: probed.duration }),
    ...(probed.fps !== undefined && { fps: probed.fps }),
    ...(probed.hasAudio !== undefined && { hasAudio: probed.hasAudio }),
  };
  return {
    document: known ? document : { ...document, media: [...document.media, media] },
    media,
    file,
  };
}

export async function addMedia(
  document: VideoProjectDocument,
  edit: AddOperation,
  loadMedia: (itemId: string) => Promise<File>,
): Promise<VideoProjectDocument> {
  const registered = await registerMedia(document, edit.item_id, loadMedia);
  const { media: probed, file } = registered;
  const next: VideoProjectDocument = {
    ...registered.document,
    project: registered.document.project ?? newProject(file.name.replace(/\.[^.]+$/, "")),
  };
  const assetId = probed.assetId;
  const start = edit.start ?? 0;
  const natural =
    probed.duration != null
      ? mediaTimeFromSeconds({ seconds: probed.duration })
      : DEFAULT_NEW_ELEMENT_DURATION;
  const duration =
    edit.end !== undefined && edit.end > start
      ? Math.min(natural, ticks(edit.end - start))
      : natural;
  const element = {
    ...buildElementFromMedia({
      mediaId: assetId,
      mediaType: probed.type,
      name: probed.name,
      duration: duration as MediaTime,
      startTime: ticks(start) as MediaTime,
    }),
    id: generateUUID(),
  } as TimelineElement;
  const project = projectOf(next);
  const scene = sceneOf(project);
  const track = probed.type === "audio" ? "audio" : (edit.track ?? "main");
  if (track === "main") {
    if (probed.type === "audio") throw new Error("Sound goes on an audio track.");
    scene.tracks = insertOnMain(scene.tracks, element, edit.start ?? durationOf(scene.tracks));
  } else {
    const fresh = buildEmptyTrack({
      id: generateUUID(),
      type: track === "audio" ? "audio" : "video",
    });
    const placed = { ...fresh, elements: [element] } as TimelineTrack;
    scene.tracks =
      track === "audio"
        ? { ...scene.tracks, audio: [...scene.tracks.audio, placed] as SceneTracks["audio"] }
        : { ...scene.tracks, overlay: [placed, ...scene.tracks.overlay] as SceneTracks["overlay"] };
  }
  return next;
}
