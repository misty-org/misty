export { VideoEditor, VideoEditorOpening } from "./VideoEditor";
export { canEditVideo, VIDEO_EDITING_UNAVAILABLE } from "./support";
export type {
  VideoDestination,
  VideoEditorProps,
  VideoProjectSource,
  VideoSpaceMedia,
} from "./videoEditorTypes";
export {
  emptyVideoProject,
  isVideoProjectFile,
  parseVideoProject,
  VIDEO_PROJECT_EXTENSION,
  VIDEO_PROJECT_MIME,
  type VideoProjectDocument,
} from "./projectDocumentTypes";

/** The tools agents use on video projects, once OpenCut's core is loaded. */
export async function loadVideoProjectTools() {
  const { loadOpencutWasm } = await import("@opencut/wasm/load");
  await loadOpencutWasm();
  return import("./tools");
}
export type VideoProjectTools = Awaited<ReturnType<typeof loadVideoProjectTools>>;
export { newerProject, readRoomProject, writeRoomProject } from "./projectRoom";
export { copyVideoProject } from "./projectCopy";
