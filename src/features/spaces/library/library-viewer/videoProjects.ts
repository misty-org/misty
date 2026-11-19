import {
  copyVideoProject,
  emptyVideoProject,
  isVideoProjectFile,
  parseVideoProject,
  VIDEO_PROJECT_EXTENSION,
  VIDEO_PROJECT_MIME,
} from "@/features/files";
import { spacesApi } from "../../api/api";
import type { SpaceLibraryItem } from "../../api/dto/entities";
import { libraryItemMIME } from "../library-primitives/libraryMediaTypes";

/** Media items a just-made project lays on its timeline when it first opens, by project id. */
const startsWith = new Map<string, string[]>();

/**
 * Makes a new video project in the Space's Media, empty or made from the given photos and
 * videos (in that order, laid on its timeline the first time it opens). Returns its item.
 */
export async function createVideoProject(
  spaceId: string,
  name: string,
  fromItemIds: string[] = [],
): Promise<SpaceLibraryItem> {
  const blob = new Blob([JSON.stringify(emptyVideoProject())], { type: VIDEO_PROJECT_MIME });
  const result = await spacesApi.uploadLibraryBlob(
    spaceId,
    blob,
    `${name}${VIDEO_PROJECT_EXTENSION}`,
    "library",
  );
  if (!result.item) throw new Error("The video could not be made.");
  if (fromItemIds.length) startsWith.set(result.item.id, fromItemIds);
  return result.item;
}

/**
 * The media a just-made project starts with. It is used only while the project is still empty,
 * and forgotten once the project is first kept.
 */
export function projectStart(itemId: string): string[] {
  return startsWith.get(itemId) ?? [];
}

export function forgetProjectStart(itemId: string): void {
  startsWith.delete(itemId);
}

/**
 * Gives a just-duplicated Media item, when it is a video project, a project of its own: the
 * server copies the file as it is, project id included, and two projects with one id would be
 * taken for one by the editor. The copy keeps its timeline and the Media items it points at.
 */
export async function renewDuplicatedVideoProject(
  spaceId: string,
  item: SpaceLibraryItem,
): Promise<void> {
  const filename = item.file.original_filename || `${item.display_name}${VIDEO_PROJECT_EXTENSION}`;
  if (!isVideoProjectFile(libraryItemMIME(item), filename)) return;
  const kept = parseVideoProject(await (await spacesApi.libraryContent(spaceId, item.id)).text());
  const name = item.display_name.replace(/\.mistyvideo$/i, "") || "Untitled video";
  const blob = new Blob([JSON.stringify(copyVideoProject(kept, name))], {
    type: VIDEO_PROJECT_MIME,
  });
  await spacesApi.replaceLibraryItemContent(spaceId, item, blob, filename);
}
