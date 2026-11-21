import type { SpaceMessage } from "./dto/entities";
import type { SpaceRequest } from "./spaceRequestTypes";

/**
 * Where a chat's pins live: the Space-wide chat (and a DM, whose id is a Space id) when
 * `conversationId` is empty, otherwise that channel.
 */
function pinsBase(spaceId: string, conversationId: string) {
  const space = `/spaces/${encodeURIComponent(spaceId)}`;
  return conversationId ? `${space}/conversations/${encodeURIComponent(conversationId)}` : space;
}

export function createSpacePinsApi(request: SpaceRequest) {
  return {
    /** In a DM anyone may pin; in a Space only those who may manage messages. */
    pinMessage: (spaceId: string, conversationId: string, messageId: string) =>
      request(`${pinsBase(spaceId, conversationId)}/messages/${encodeURIComponent(messageId)}/pin`, {
        method: "PUT",
      }),
    unpinMessage: (spaceId: string, conversationId: string, messageId: string) =>
      request(`${pinsBase(spaceId, conversationId)}/messages/${encodeURIComponent(messageId)}/pin`, {
        method: "DELETE",
      }),
    /** A chat's pinned messages, the most recently pinned first, at most 50. */
    pinnedMessages: (spaceId: string, conversationId: string) =>
      request<{ messages: SpaceMessage[] }>(`${pinsBase(spaceId, conversationId)}/pins`).then(
        (result) => result.messages ?? [],
      ),
  };
}
