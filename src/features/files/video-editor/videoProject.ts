import { EditorCore } from "@opencut/core";
import { processMediaAssets } from "@opencut/media/processing";
import { buildElementFromMedia } from "@opencut/timeline/element-utils";
import { DEFAULT_NEW_ELEMENT_DURATION } from "@opencut/timeline/creation";
import { mediaTimeFromSeconds, ZERO_MEDIA_TIME } from "@opencut/wasm";

/*
 * OpenCut's modules read its Rust core as they load, so this file is only ever imported after
 * `loadOpencutWasm` has finished (VideoEditor imports VideoEditorSession, and through it this,
 * dynamically).
 */

/**
 * A video project of the editor's own (OpenCut's, kept in this window's storage), saved before
 * any media is read, so the editor can open while the file is imported. Returns its id.
 */
export function startVideoProject(name: string): Promise<string> {
  return EditorCore.getInstance().project.createNewProject({ name });
}

/**
 * Imports a file into the open project and lays it on the main track after what is there (at
 * the start of an empty one). Returns the media asset's id.
 */
export async function placeSourceOnTimeline(projectId: string, file: File): Promise<string> {
  const editor = EditorCore.getInstance();
  const [processed] = await processMediaAssets({ files: [file] });
  if (!processed) throw new Error(`“${file.name}” could not be read as a video.`);
  const asset = await editor.media.addMediaAsset({ projectId, asset: processed });
  if (!asset) throw new Error(`“${file.name}” could not be added to the video.`);
  editor.timeline.insertElement({
    element: buildElementFromMedia({
      mediaId: asset.id,
      mediaType: asset.type,
      name: asset.name,
      duration:
        asset.duration != null
          ? mediaTimeFromSeconds({ seconds: asset.duration })
          : DEFAULT_NEW_ELEMENT_DURATION,
      startTime: ZERO_MEDIA_TIME,
    }),
    placement: { mode: "auto" },
  });
  return asset.id;
}

/** How many editing sessions have each project open: a project reopened while closing stays. */
const openSessions = new Map<string, number>();

/** Notes that a session has a project open. */
export function claimVideoProject(projectId: string): void {
  openSessions.set(projectId, (openSessions.get(projectId) ?? 0) + 1);
}

/**
 * Notes that a session is done with a project, and removes the editor's copy once no session
 * has it open.
 */
export async function releaseVideoProject(projectId: string): Promise<void> {
  const left = (openSessions.get(projectId) ?? 1) - 1;
  if (left > 0) {
    openSessions.set(projectId, left);
    return;
  }
  openSessions.delete(projectId);
  await discardVideoProject(projectId);
}

/**
 * Removes the project from this window's storage, closing it first when it is the open one.
 * Saving stops before it closes, so no save of it lands after it is gone; opening the next
 * project starts saving again.
 */
export async function discardVideoProject(projectId: string): Promise<void> {
  const editor = EditorCore.getInstance();
  if (editor.project.getActiveOrNull()?.metadata.id === projectId) {
    editor.save.pause();
    editor.project.closeProject();
  }
  await editor.project.deleteProjects({ ids: [projectId] });
}
