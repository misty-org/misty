import { useCallback, useMemo } from "react";
import { drawingsApi } from "../journal/drawings/api/api";
import { useSpaceDrawingList } from "../journal/drawings/api/drawingsResource";
import { notesApi } from "../journal/notes/api/api";
import { useSpaceNoteList } from "../journal/notes/api/notesResource";
import { spacesApi } from "../api/api";
import type { LibraryItemQuery, SpaceLibraryItem } from "../api/dto/entities";
import { libraryItemsPath } from "../api/library-items-query";
import { useSpaceResource } from "../api/spaceResource";
import { useSpaceConversationList } from "../chat/spaceConversationsResource";
import {
  chatItem,
  drawingItem,
  libraryGalleryItem,
  noteItem,
  type GalleryItem,
} from "./galleryItems";

/** How many recent files the home page reads; the Files tab of the Library has the rest. */
const FILE_LIMIT = 60;

const recentFiles: LibraryItemQuery = {
  limit: FILE_LIMIT,
  sort: "recently-added",
  direction: "desc",
};

const names = ["chats", "notes", "drawings", "files"];

interface SpaceGallery {
  items: GalleryItem[];
  /** True only on a first read with nothing saved. Later reads keep the current items on screen. */
  loading: boolean;
  /** Kinds whose last read failed; what they showed before, and the rest, still show. */
  failed: string[];
  reload: () => void;
}

/** Everything made in a Space: chats, notes, drawings, files and images. */
export function useSpaceGallery(
  spaceId: string,
  me: string,
  canEditLibrary = true,
  isSpaceOwner = false,
): SpaceGallery {
  // Each kind comes from its cached copy, the one the Journal, the chat and the overview share:
  // the last lists paint at once on a revisit or relaunch and fresh ones load behind them.
  const conversations = useSpaceConversationList(spaceId);
  const notes = useSpaceNoteList(spaceId);
  const drawings = useSpaceDrawingList(spaceId);
  const files = useSpaceResource<SpaceLibraryItem[]>(
    spaceId ? libraryItemsPath(spaceId, recentFiles) : null,
    () => spacesApi.libraryItems(spaceId, recentFiles).then((r) => r.items),
  );
  const sources = [conversations, notes, drawings, files];

  const items = useMemo(
    () => [
      ...(conversations.data ?? []).map((conversation) => ({
        ...chatItem(spaceId, conversation, me),
        ...(isSpaceOwner || conversation.created_by_user_id === me
          ? {
              remove: () => spacesApi.deleteOrClearConversation(spaceId, conversation.id),
              removeLabel: "Delete",
            }
          : {}),
      })),
      ...(notes.data ?? []).map((note) => ({
        ...noteItem(spaceId, note),
        ...((note.can_delete ?? note.role === "creator")
          ? { remove: () => notesApi.remove(spaceId, note.id), removeLabel: "Delete" }
          : {}),
      })),
      ...(drawings.data ?? [])
        .filter((drawing) => drawing.lifecycle_state === "active")
        .map((drawing) => ({
          ...drawingItem(spaceId, drawing),
          ...(drawing.can_delete
            ? { remove: () => drawingsApi.remove(spaceId, drawing.id), removeLabel: "Delete" }
            : {}),
        })),
      ...(files.data ?? []).map((item) => ({
        ...libraryGalleryItem(spaceId, item),
        ...(canEditLibrary
          ? {
              remove: () => spacesApi.trashLibraryItem(spaceId, item.id),
              removeLabel: "Move to Trash",
            }
          : {}),
      })),
    ],
    [
      canEditLibrary,
      conversations.data,
      drawings.data,
      files.data,
      isSpaceOwner,
      me,
      notes.data,
      spaceId,
    ],
  );

  const failed = sources.flatMap((source, index) => (source.error ? [names[index]] : []));
  const { reload: reloadChats } = conversations;
  const { reload: reloadNotes } = notes;
  const { reload: reloadDrawings } = drawings;
  const { reload: reloadFiles } = files;
  const reload = useCallback(() => {
    for (const read of [reloadChats, reloadNotes, reloadDrawings, reloadFiles]) void read();
  }, [reloadChats, reloadDrawings, reloadFiles, reloadNotes]);
  return {
    items,
    loading: sources.some((source) => source.loading),
    failed,
    reload,
  };
}
