import { useMemo } from "react";
import { spacesApi } from "../api/api";
import { useSpaceConversationList } from "../chat/spaceConversationsResource";
import { chatItem, type GalleryItem } from "./galleryItems";

interface SpaceGallery {
  items: GalleryItem[];
  /** True only on a first read with nothing saved. Later reads keep the current items on screen. */
  loading: boolean;
  /** Kinds whose last read failed; what they showed before still shows. */
  failed: string[];
  /** The read failed and there was no saved copy: there is nothing to show at all. */
  unavailable: boolean;
  reload: () => void;
}

/** What is in a Space for search: its chats. Its files are in its drive. */
export function useSpaceGallery(spaceId: string, me: string, isSpaceOwner = false): SpaceGallery {
  // From its cached copy, which the chat shares: the last list paints at once on a revisit or
  // relaunch and a fresh one loads behind it.
  const conversations = useSpaceConversationList(spaceId);

  const items = useMemo(
    () =>
      (conversations.data ?? []).map((conversation) => ({
        ...chatItem(spaceId, conversation, me),
        ...(isSpaceOwner || conversation.created_by_user_id === me
          ? {
              remove: () => spacesApi.deleteOrClearConversation(spaceId, conversation.id),
              removeLabel: "Delete",
            }
          : {}),
      })),
    [conversations.data, isSpaceOwner, me, spaceId],
  );

  const { reload } = conversations;
  return {
    items,
    loading: conversations.loading,
    failed: conversations.error ? ["chats"] : [],
    unavailable: Boolean(conversations.error && !conversations.data),
    reload: () => void reload(),
  };
}
