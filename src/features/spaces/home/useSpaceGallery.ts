import { useCallback, useEffect, useMemo, useRef } from "react";
import { drawingsApi } from "../journal/drawings/api/api";
import { useSpaceDrawingList } from "../journal/drawings/api/drawingsResource";
import { notesApi } from "../journal/notes/api/api";
import { useSpaceNoteList } from "../journal/notes/api/notesResource";
import { spacesApi } from "../api/api";
import type { LibraryItemQuery, SpaceLibraryItem } from "../api/dto/entities";
import { libraryItemsPath } from "../api/library-items-query";
import { useSpaceResource } from "../api/spaceResource";
import { useSpaceConversationList } from "../chat/spaceConversationsResource";
import { decksApi } from "../slides/api";
import { workbooksApi } from "../data/api";
import { useSpaceDeckList, useSpaceWorkbookList } from "../api/madeLists";
import {
  chatItem,
  deckItem,
  drawingItem,
  libraryGalleryItem,
  noteItem,
  workbookItem,
  type GalleryItem,
} from "./galleryItems";

/** How many recent files the home page reads; the Files tab of the Library has the rest. */
const FILE_LIMIT = 60;

const recentFiles: LibraryItemQuery = {
  limit: FILE_LIMIT,
  sort: "recently-added",
  direction: "desc",
};

const names = ["chats", "docs", "slides", "data", "whiteboards", "files"];

interface SpaceGallery {
  items: GalleryItem[];
  /** True only on a first read with nothing saved. Later reads keep the current items on screen. */
  loading: boolean;
  /** Kinds whose last read failed; what they showed before, and the rest, still show. */
  failed: string[];
  /** Every kind's read failed and none had a saved copy: there is nothing to show at all. */
  unavailable: boolean;
  reload: () => void;
}

/** Everything made in a Space: chats, docs, decks, workbooks, whiteboards, files and images. */
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
  const decks = useSpaceDeckList(spaceId);
  const workbooks = useSpaceWorkbookList(spaceId);
  const files = useSpaceResource<SpaceLibraryItem[]>(
    spaceId ? libraryItemsPath(spaceId, recentFiles) : null,
    () => spacesApi.libraryItems(spaceId, recentFiles).then((r) => r.items),
  );
  const sources = [conversations, notes, decks, workbooks, drawings, files];

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
      ...(decks.data ?? [])
        .filter((deck) => deck.lifecycle_state === "active")
        .map((deck) => ({
          ...deckItem(spaceId, deck),
          ...(deck.can_delete
            ? { remove: () => decksApi.remove(spaceId, deck.id), removeLabel: "Delete" }
            : {}),
        })),
      ...(workbooks.data ?? [])
        .filter((workbook) => workbook.lifecycle_state === "active")
        .map((workbook) => ({
          ...workbookItem(spaceId, workbook),
          ...(workbook.can_delete
            ? { remove: () => workbooksApi.remove(spaceId, workbook.id), removeLabel: "Delete" }
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
      decks.data,
      drawings.data,
      files.data,
      isSpaceOwner,
      me,
      notes.data,
      spaceId,
      workbooks.data,
    ],
  );

  // Decks and workbooks have no page of their own listening while the home shows, so the home
  // reads them again when the Space says one changed. The reads go through a ref, so the
  // listeners are set once per Space.
  const reloads = useRef({ deck: decks.reload, workbook: workbooks.reload });
  useEffect(() => {
    reloads.current = { deck: decks.reload, workbook: workbooks.reload };
  });
  useEffect(() => {
    const listeners = (["deck", "workbook"] as const).map((kind) => {
      const name = `misty:space-${kind}-event`;
      const refresh = (event: Event) => {
        const id = (event as CustomEvent<{ space_id?: string }>).detail?.space_id;
        if (!id || id === spaceId) void reloads.current[kind]();
      };
      window.addEventListener(name, refresh);
      return () => window.removeEventListener(name, refresh);
    });
    return () => listeners.forEach((remove) => remove());
  }, [spaceId]);

  const failed = sources.flatMap((source, index) => (source.error ? [names[index]] : []));
  const { reload: reloadChats } = conversations;
  const { reload: reloadNotes } = notes;
  const { reload: reloadDecks } = decks;
  const { reload: reloadWorkbooks } = workbooks;
  const { reload: reloadDrawings } = drawings;
  const { reload: reloadFiles } = files;
  const reload = useCallback(() => {
    for (const read of [
      reloadChats,
      reloadNotes,
      reloadDecks,
      reloadWorkbooks,
      reloadDrawings,
      reloadFiles,
    ])
      void read();
  }, [reloadChats, reloadDecks, reloadDrawings, reloadFiles, reloadNotes, reloadWorkbooks]);
  return {
    items,
    loading: sources.some((source) => source.loading),
    failed,
    unavailable: sources.every((source) => source.error && !source.data),
    reload,
  };
}
