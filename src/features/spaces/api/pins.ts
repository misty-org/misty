import type { SpaceMessage } from "./dto/entities";
import type { SpaceRequest } from "./space_request_types";

function pinsBase(spaceId: string, conversationId: string) {
  const space = `/spaces/${encodeURIComponent(spaceId)}`;
  return conversationId ? `${space}/conversations/${encodeURIComponent(conversationId)}` : space;
}

export function createSpacePinsApi(request: SpaceRequest) {
  return {
    pinMessage: (spaceId: string, conversationId: string, messageId: string) =>
      request(
        `${pinsBase(spaceId, conversationId)}/messages/${encodeURIComponent(messageId)}/pin`,
        {
          method: "PUT",
        },
      ),
    unpinMessage: (spaceId: string, conversationId: string, messageId: string) =>
      request(
        `${pinsBase(spaceId, conversationId)}/messages/${encodeURIComponent(messageId)}/pin`,
        {
          method: "DELETE",
        },
      ),
    pinnedMessages: (spaceId: string, conversationId: string) =>
      request<{ messages: SpaceMessage[] }>(`${pinsBase(spaceId, conversationId)}/pins`).then(
        (result) => result.messages ?? [],
      ),
  };
}
