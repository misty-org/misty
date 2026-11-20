import { spacesApi } from "../../api/api";
import type { SpaceLibraryItem } from "../../api/dto/entities";
import { libraryItemMIME } from "../library-primitives/libraryMediaTypes";

/** One of the Space's files as a File that can be read. */
export async function libraryFile(spaceId: string, item: SpaceLibraryItem): Promise<File> {
  const blob = await spacesApi.libraryContent(spaceId, item.id);
  const name = item.file.original_filename || item.display_name;
  return new File([blob], name, { type: blob.type || libraryItemMIME(item) });
}

/** Reads one of the Space's files by its item's id. */
export async function libraryFileById(spaceId: string, itemId: string): Promise<File> {
  return libraryFile(spaceId, await spacesApi.libraryItem(spaceId, itemId));
}
