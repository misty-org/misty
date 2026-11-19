import { EditorCore } from "@opencut/core";
import { storageService } from "@opencut/services/storage/service";
import type { SerializedProject } from "@opencut/services/storage/types";
import type { MediaAsset } from "@opencut/media/types";
import { startVideoProject } from "./videoProject";
import type { VideoProjectDocument, VideoProjectMedia } from "./projectDocumentTypes";

/*
 * Moving a video project between its Space and the editor's own storage. Like videoProject.ts,
 * this reads OpenCut's modules, so it loads after OpenCut's core (through VideoEditorSession).
 */

/**
 * Puts a project kept in a Space into the editor's storage, under its own id, with each media
 * file it uses read from the Space. A new project is made for one that has nothing yet. Returns
 * the project's id, for the editor to open.
 */
export async function openVideoProject(
  name: string,
  document: VideoProjectDocument,
  loadMedia: (itemId: string) => Promise<File>,
): Promise<string> {
  if (document.project === null) return startVideoProject(name);
  const project = document.project as SerializedProject;
  await storageService.writeSerializedProject({ project });
  await Promise.all(
    document.media.map(async (media) => {
      const file = await loadMedia(media.itemId);
      const asset: MediaAsset = {
        id: media.assetId,
        name: media.name,
        type: media.type,
        width: media.width,
        height: media.height,
        duration: media.duration,
        fps: media.fps,
        hasAudio: media.hasAudio,
        file,
      };
      await storageService.saveMediaAsset({ projectId: project.metadata.id, mediaAsset: asset });
    }),
  );
  return project.metadata.id;
}

/** A media file the project uses that isn't in the Space yet (imported from the computer). */
export interface UnkeptMedia {
  assetId: string;
  file: File;
}

/**
 * The open project as it should be kept in its Space, after its latest change is stored: the
 * document, and the media it uses that has no Space item yet (`itemIds` names the ones that do).
 * The document lists only media that has an item; once the rest is in the Space, call again.
 */
export async function captureVideoProject(
  projectId: string,
  itemIds: ReadonlyMap<string, string>,
): Promise<{ document: VideoProjectDocument; unkept: UnkeptMedia[] }> {
  const editor = EditorCore.getInstance();
  // Only unsaved work is flushed: a flush saves, and a save calls the keeper back.
  if (editor.save.getIsDirty()) await editor.save.flush();
  const project = await storageService.readSerializedProject({ id: projectId });
  if (!project) throw new Error("The video project could not be read to save it.");
  const media: VideoProjectMedia[] = [];
  const unkept: UnkeptMedia[] = [];
  for (const asset of editor.media.getAssets()) {
    if (asset.ephemeral) continue;
    const itemId = itemIds.get(asset.id);
    if (!itemId) {
      unkept.push({ assetId: asset.id, file: asset.file });
      continue;
    }
    media.push({
      assetId: asset.id,
      itemId,
      name: asset.name,
      type: asset.type,
      ...(asset.width !== undefined && { width: asset.width }),
      ...(asset.height !== undefined && { height: asset.height }),
      ...(asset.duration !== undefined && { duration: asset.duration }),
      ...(asset.fps !== undefined && { fps: asset.fps }),
      ...(asset.hasAudio !== undefined && { hasAudio: asset.hasAudio }),
    });
  }
  return { document: { kind: "misty.video", version: 1, project, media }, unkept };
}

/**
 * Shows a document someone else changed in the open editor: media it uses that this window
 * doesn't have yet is read from the Space, then the project's scenes are swapped in place, with
 * the editor still showing (a reload would empty it first, and its panels need a scene). Saving
 * is paused while it swaps, so showing a change doesn't keep it again.
 */
export async function showRemoteProject(
  document: VideoProjectDocument,
  loadMedia: (itemId: string) => Promise<File>,
): Promise<void> {
  if (document.project === null) return;
  const editor = EditorCore.getInstance();
  const project = document.project as SerializedProject;
  const known = new Set(editor.media.getAssets().map((asset) => asset.id));
  const fresh = document.media.filter((media) => !known.has(media.assetId));
  await Promise.all(
    fresh.map(async (media) => {
      const file = await loadMedia(media.itemId);
      await storageService.saveMediaAsset({
        projectId: project.metadata.id,
        mediaAsset: {
          id: media.assetId,
          name: media.name,
          type: media.type,
          width: media.width,
          height: media.height,
          duration: media.duration,
          fps: media.fps,
          hasAudio: media.hasAudio,
          file,
        },
      });
    }),
  );
  await storageService.writeSerializedProject({ project });
  const loaded = await storageService.loadProject({ id: project.metadata.id });
  if (!loaded) throw new Error("A change to the video could not be read.");
  editor.save.pause();
  try {
    if (fresh.length) await editor.media.loadProjectMedia({ projectId: project.metadata.id });
    editor.project.setActiveProject({ project: loaded.project });
    editor.scenes.initializeScenes({
      scenes: loaded.project.scenes,
      currentSceneId: loaded.project.currentSceneId,
    });
  } finally {
    editor.save.resume();
  }
}
