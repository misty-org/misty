import { TICKS_PER_SECOND } from "@opencut/wasm";
import type { SerializedProject, SerializedScene } from "@opencut/services/storage/types";
import type { SceneTracks, TimelineElement, TimelineTrack } from "@opencut/timeline";
import { calculateTotalDuration } from "@opencut/timeline";
import type { VideoProjectDocument } from "../projectDocumentTypes";

/*
 * A video project as agents work with it: its document, read and changed as plain data, with no
 * editor open. Like the rest of video-editor/tools, this reads OpenCut's modules, so it loads
 * after OpenCut's core (`loadVideoProjectTools`).
 */

export const seconds = (ticks: number) => Math.round((ticks / TICKS_PER_SECOND) * 1000) / 1000;
export const ticks = (value: number) => Math.round(value * TICKS_PER_SECOND);

export function projectOf(document: VideoProjectDocument): SerializedProject {
  if (document.project === null)
    throw new Error("This video is empty: add media to it first (video_edit add).");
  return document.project as SerializedProject;
}

/** The scene the editor shows: the project's current one, or its main one. */
export function sceneOf(project: SerializedProject): SerializedScene {
  const scene =
    project.scenes.find((candidate) => candidate.id === project.currentSceneId) ??
    project.scenes.find((candidate) => candidate.isMain) ??
    project.scenes[0];
  if (!scene) throw new Error("This video has no scene.");
  return scene;
}

export function allTracks(tracks: SceneTracks): TimelineTrack[] {
  return [...tracks.overlay, tracks.main, ...tracks.audio];
}

export function durationOf(tracks: SceneTracks): number {
  return calculateTotalDuration({ tracks });
}

/** The Media item a clip's media comes from, by the project's media list. */
export function itemOf(
  document: VideoProjectDocument,
  element: TimelineElement,
): string | undefined {
  if (!("mediaId" in element)) return undefined;
  return document.media.find((media) => media.assetId === element.mediaId)?.itemId;
}

/** A deep copy of a document, to change without touching the one read. */
export function copyDocument(document: VideoProjectDocument): VideoProjectDocument {
  return structuredClone(document);
}
