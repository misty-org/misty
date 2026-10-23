import { useCallback, useEffect, useRef, useState } from "react";
import { drawingsApi } from "@/api/drawings/api";
import { notesApi } from "@/api/notes/api";
import { spacesApi } from "@/api/spaces/api";
import { codeProjectsApi } from "@/api/spaces/code-projects";
import {
  chatItem,
  codeItem,
  drawingItem,
  libraryGalleryItem,
  noteItem,
  type GalleryItem,
} from "./galleryItems";

/** How many recent files the home page reads; the Files tab of the Library has the rest. */
const FILE_LIMIT = 60;

export interface SpaceGallery {
  items: GalleryItem[];
  /** True until the first read finishes. Later reads keep the current items on screen. */
  loading: boolean;
  /** Kinds that couldn't be read this time; the rest still show. */
  failed: string[];
  reload: () => void;
}

/** Everything made in a Space: chats, notes, drawings, files and images, and code projects. */
export function useSpaceGallery(
  spaceId: string,
  me: string,
  canEditLibrary = true,
  isSpaceOwner = false,
): SpaceGallery {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string[]>([]);
  const [version, setVersion] = useState(0);
  const loadedFor = useRef("");

  useEffect(() => {
    let live = true;
    if (loadedFor.current !== spaceId) {
      setItems([]);
      setLoading(true);
    }
    const controller = new AbortController();
    void Promise.allSettled([
      spacesApi.conversations(spaceId).then((r) =>
        r.conversations.map((conversation) => ({
          ...chatItem(spaceId, conversation, me),
          ...(isSpaceOwner ||
          conversation.created_by_user_id === me ||
          conversation.kind === "direct"
            ? {
                remove: () => spacesApi.deleteOrClearConversation(spaceId, conversation.id),
                removeLabel: "Delete",
              }
            : {}),
        })),
      ),
      notesApi.list(spaceId).then((r) =>
        r.notes.map((note) => ({
          ...noteItem(spaceId, note),
          ...((note.can_delete ?? note.role === "creator")
            ? { remove: () => notesApi.remove(spaceId, note.id), removeLabel: "Delete" }
            : {}),
        })),
      ),
      drawingsApi.list(spaceId).then((r) =>
        r.drawings
          .filter((drawing) => drawing.lifecycle_state === "active")
          .map((drawing) => ({
            ...drawingItem(spaceId, drawing),
            ...(drawing.can_delete
              ? { remove: () => drawingsApi.remove(spaceId, drawing.id), removeLabel: "Delete" }
              : {}),
          })),
      ),
      spacesApi
        .libraryItems(spaceId, { limit: FILE_LIMIT, sort: "recently-added", direction: "desc" })
        .then((r) =>
          r.items.map((item) => ({
            ...libraryGalleryItem(spaceId, item),
            ...(canEditLibrary
              ? {
                  remove: () => spacesApi.trashLibraryItem(spaceId, item.id),
                  removeLabel: "Move to Trash",
                }
              : {}),
          })),
        ),
      codeProjectsApi.list(spaceId, controller.signal).then((r) =>
        r.projects.map((project) => ({
          ...codeItem(spaceId, project),
          ...(isSpaceOwner || project.owner_user_id === me
            ? { remove: () => codeProjectsApi.unlink(spaceId, project.id), removeLabel: "Unlink" }
            : {}),
        })),
      ),
    ]).then((results) => {
      if (!live) return;
      const names = ["chats", "notes", "drawings", "files", "code projects"];
      setItems(results.flatMap((result) => (result.status === "fulfilled" ? result.value : [])));
      setFailed(
        results.flatMap((result, index) => (result.status === "rejected" ? [names[index]] : [])),
      );
      setLoading(false);
      loadedFor.current = spaceId;
    });
    return () => {
      live = false;
      controller.abort();
    };
  }, [spaceId, me, version, canEditLibrary, isSpaceOwner]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);
  return { items, loading, failed, reload };
}
