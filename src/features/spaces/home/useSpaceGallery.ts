import { useCallback, useMemo } from "react";
import { spacesApi } from "../api/api";
import type { LibraryItemQuery, SpaceLibraryItem } from "../api/dto/entities";
import { libraryItemsPath } from "../api/library-items-query";
import { useSpaceResource } from "../api/spaceResource";
import { useSpaceConversationList } from "../chat/spaceConversationsResource";
import { chatItem, libraryGalleryItem, type GalleryItem } from "./galleryItems";

/** How many recent files are read; Files has the rest. */
const FILE_LIMIT = 60;

const recentFiles: LibraryItemQuery = {
  limit: FILE_LIMIT,
  sort: "recently-added",
  direction: "desc",
};

const names = ["chats", "files"];

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

/** What is in a Space for search: its chats and its recent files. */
export function useSpaceGallery(
  spaceId: string,
  me: string,
  canEditLibrary = true,
  isSpaceOwner = false,
): SpaceGallery {
  // Each kind comes from its cached copy, which the chat and Files share: the last lists paint at
  // once on a revisit or relaunch and fresh ones load behind them.
  const conversations = useSpaceConversationList(spaceId);
  const files = useSpaceResource<SpaceLibraryItem[]>(
    spaceId ? libraryItemsPath(spaceId, recentFiles) : null,
    () => spacesApi.libraryItems(spaceId, recentFiles).then((r) => r.items),
  );
  const sources = [conversations, files];

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
    [canEditLibrary, conversations.data, files.data, isSpaceOwner, me, spaceId],
  );

  const failed = sources.flatMap((source, index) => (source.error ? [names[index]] : []));
  const { reload: reloadChats } = conversations;
  const { reload: reloadFiles } = files;
  const reload = useCallback(() => {
    void reloadChats();
    void reloadFiles();
  }, [reloadChats, reloadFiles]);
  return {
    items,
    loading: sources.some((source) => source.loading),
    failed,
    unavailable: sources.every((source) => source.error && !source.data),
    reload,
  };
}
