import type { TimelineElement } from "@opencut/timeline";
import type { VideoProjectDocument } from "../projectDocumentTypes";
import { describeMotionGraphic } from "./motionEdits";
import { allTracks, durationOf, itemOf, projectOf, sceneOf, seconds } from "./projectModel";

/** The params worth reading about a clip, when they differ from their rest values. */
const SHOWN_PARAMS =
  /^(opacity|volume|muted|content|fontSize|color|adjust\.|transition\.|caption\.style$|karaoke\.enabled$)/;

function describeElement(document: VideoProjectDocument, element: TimelineElement) {
  const motion = describeMotionGraphic(element);
  const params = Object.fromEntries(
    Object.entries(element.params ?? {}).filter(([key]) => SHOWN_PARAMS.test(key)),
  );
  return {
    id: element.id,
    type: element.type,
    name: element.name,
    start: seconds(element.startTime),
    end: seconds(element.startTime + element.duration),
    ...(itemOf(document, element) && { item_id: itemOf(document, element) }),
    ...("retime" in element && element.retime && { speed: element.retime }),
    ...(Object.keys(params).length > 0 && { params }),
    ...(motion && { motion }),
  };
}

/** A video project as an agent reads it: its frame, its length, and each track's clips. */
export function describeVideoProject(document: VideoProjectDocument) {
  if (document.project === null) return { empty: true, duration: 0, tracks: [] };
  const project = projectOf(document);
  const scene = sceneOf(project);
  const mainId = scene.tracks.main.id;
  return {
    name: project.metadata.name,
    frame: project.settings.canvasSize,
    fps: project.settings.fps,
    duration: seconds(durationOf(scene.tracks)),
    scenes: project.scenes.map((each) => ({
      id: each.id,
      name: each.name,
      open: each.id === scene.id,
    })),
    tracks: allTracks(scene.tracks).map((track) => ({
      id: track.id,
      type: track.id === mainId ? "main" : track.type,
      elements: track.elements.map((element) => describeElement(document, element)),
    })),
    media: document.media.map((media) => ({
      item_id: media.itemId,
      name: media.name,
      type: media.type,
      ...(media.duration !== undefined && { duration: media.duration }),
    })),
  };
}
