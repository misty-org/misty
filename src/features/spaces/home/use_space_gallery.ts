import { useMemo } from "react";
import { spacesApi } from "../api/api";
import { useSpaceConversationList } from "../chat/space_conversations_resource";
import { chatItem, type GalleryItem } from "./gallery_items";

interface SpaceGallery {
  items: GalleryItem[];
  loading: boolean;
  failed: string[];
  unavailable: boolean;
  reload: () => void;
}

export function useSpaceGallery(spaceId: string, me: string, isSpaceOwner = false): SpaceGallery {
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
