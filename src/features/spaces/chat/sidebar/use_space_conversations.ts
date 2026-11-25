import type { SpaceChannelCategory, SpaceConversation } from "../../api/dto/entities";
import { useEffect } from "react";
import {
  reloadSpaceConversations,
  updateSpaceChannelCategories,
  updateSpaceConversations,
  useSpaceChannelCategoryList,
  useSpaceConversationList,
} from "../space_conversations_resource";

const noConversations: SpaceConversation[] = [];
const noCategories: SpaceChannelCategory[] = [];

export function useSpaceConversations(spaceId: string) {
  const resource = useSpaceConversationList(spaceId);
  const categoryList = useSpaceChannelCategoryList(spaceId);
  useEffect(() => {
    if (!spaceId) return;
    const onEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ space_id?: string }>).detail;
      if (detail?.space_id !== spaceId) return;
      void reloadSpaceConversations(spaceId).catch(() => {});
    };
    window.addEventListener("misty:space-conversation-event", onEvent);
    return () => window.removeEventListener("misty:space-conversation-event", onEvent);
  }, [spaceId]);
  const upsert = (saved: SpaceConversation) =>
    updateSpaceConversations(spaceId, (current) =>
      current.some((item) => item.id === saved.id)
        ? current.map((item) => (item.id === saved.id ? saved : item))
        : [saved, ...current],
    );
  const remove = (conversationId: string) =>
    updateSpaceConversations(spaceId, (current) =>
      current.filter((item) => item.id !== conversationId),
    );
  const upsertCategory = (saved: SpaceChannelCategory) =>
    updateSpaceChannelCategories(spaceId, (current) =>
      current.some((item) => item.id === saved.id)
        ? current.map((item) => (item.id === saved.id ? saved : item))
        : [...current, saved],
    );
  const removeCategory = (categoryId: string) => {
    updateSpaceChannelCategories(spaceId, (current) =>
      current.filter((item) => item.id !== categoryId),
    );
    updateSpaceConversations(spaceId, (current) =>
      current.map((item) =>
        item.category_id === categoryId ? { ...item, category_id: null } : item,
      ),
    );
  };
  return {
    conversations: resource.data ?? noConversations,
    categories: categoryList.data ?? noCategories,
    upsertCategory,
    removeCategory,
    reload: () => reloadSpaceConversations(spaceId),
    loading: resource.loading,
    error: resource.error && !resource.data ? "Chats could not be loaded." : "",
    retry: () => void resource.reload(),
    upsert,
    remove,
  };
}
