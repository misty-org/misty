import type { SpaceChannelCategory, SpaceConversation } from "../../api/dto/entities";

export interface ChannelCategoryGroup {
  category: SpaceChannelCategory;
  channels: SpaceConversation[];
}

export interface ChannelLayout {
  loose: SpaceConversation[];
  categories: ChannelCategoryGroup[];
}

const byPosition = (
  left: { position?: number; created_at: string; id: string },
  right: { position?: number; created_at: string; id: string },
) =>
  (left.position ?? 0) - (right.position ?? 0) ||
  left.created_at.localeCompare(right.created_at) ||
  left.id.localeCompare(right.id);

export function channelLayout(
  conversations: SpaceConversation[],
  categories: SpaceChannelCategory[],
): ChannelLayout {
  const known = new Set(categories.map((category) => category.id));
  const channels = conversations
    .filter((conversation) => conversation.kind !== "dm")
    .sort(byPosition);
  return {
    loose: channels.filter((channel) => !channel.category_id || !known.has(channel.category_id)),
    categories: [...categories].sort(byPosition).map((category) => ({
      category,
      channels: channels.filter((channel) => channel.category_id === category.id),
    })),
  };
}

export function channelsIn(layout: ChannelLayout, categoryId: string | null | undefined) {
  if (!categoryId) return layout.loose;
  return layout.categories.find((group) => group.category.id === categoryId)?.channels ?? [];
}

export function moveTargets<T extends { id: string }>(items: T[], id: string) {
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return { up: undefined, down: undefined };
  return {
    up: index > 0 ? (index > 1 ? items[index - 2]!.id : null) : undefined,
    down: index < items.length - 1 ? items[index + 1]!.id : undefined,
  };
}
