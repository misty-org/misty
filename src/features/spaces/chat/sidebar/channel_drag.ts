import { notify } from "@misty/ui";
import { spacesApi } from "../../api/api";
import type { SpaceChannelCategory, SpaceConversation } from "../../api/dto/entities";
import {
  reloadSpaceConversations,
  updateSpaceChannelCategories,
  updateSpaceConversations,
} from "../space_conversations_resource";

export const channelDragScope = (spaceId: string) => `space-channels:${spaceId}`;
export const categoryDragScope = (spaceId: string) => `space-categories:${spaceId}`;

function placeIn(ids: string[], moving: string, targetId: string, after: boolean) {
  const rest = ids.filter((id) => id !== moving);
  const at = rest.indexOf(targetId);
  const index = at < 0 ? (after ? rest.length : 0) : at + (after ? 1 : 0);
  const order = [...rest.slice(0, index), moving, ...rest.slice(index)];
  const unchanged = ids.length === order.length && order.every((id, i) => id === ids[i]);
  return { order, afterId: index > 0 ? rest[index - 1]! : null, unchanged };
}

const settle = (spaceId: string, failure: string) => (request: Promise<unknown>) =>
  void request
    .catch(() => notify({ message: failure, tone: "error" }))
    .finally(() => void reloadSpaceConversations(spaceId).catch(() => undefined));

export function dropChannel(
  spaceId: string,
  categoryId: string | null,
  channels: SpaceConversation[],
  moving: string,
  targetId: string,
  after: boolean,
) {
  const { order, afterId, unchanged } = placeIn(
    channels.map((channel) => channel.id),
    moving,
    targetId,
    after,
  );
  if (unchanged) return;
  updateSpaceConversations(spaceId, (current) =>
    current.map((item) => {
      const position = order.indexOf(item.id);
      return position < 0 ? item : { ...item, category_id: categoryId, position };
    }),
  );
  settle(
    spaceId,
    "The channel couldn't be moved. Try again.",
  )(spacesApi.placeConversation(spaceId, moving, categoryId, afterId));
}

export function dropCategory(
  spaceId: string,
  categories: SpaceChannelCategory[],
  moving: string,
  targetId: string,
  after: boolean,
) {
  const { order, afterId, unchanged } = placeIn(
    categories.map((category) => category.id),
    moving,
    targetId,
    after,
  );
  if (unchanged) return;
  updateSpaceChannelCategories(spaceId, (current) =>
    current.map((item) => {
      const position = order.indexOf(item.id);
      return position < 0 ? item : { ...item, position };
    }),
  );
  settle(
    spaceId,
    "The category couldn't be moved. Try again.",
  )(spacesApi.updateCategory(spaceId, moving, { afterId }));
}

export function neighbour<T extends { id: string }>(items: T[], id: string, direction: -1 | 1) {
  const index = items.findIndex((item) => item.id === id);
  return index < 0 ? undefined : items[index + direction];
}
