import type { SpaceConversation, SpaceMessage } from "./dto/entities";
import type { MessageSpan } from "./dto/common";
import type { SpaceRequest } from "./spaceRequestTypes";
import { spaceMessagePageSize } from "./chat";

export function createSpaceConversationsApi(request: SpaceRequest) {
  return {
    /** The person's conversations, each with its unread count, and Everyone's unread count. */
    conversations: (spaceId: string) =>
      request<{ conversations: SpaceConversation[]; everyone_unread_count?: number }>(
        `/spaces/${encodeURIComponent(spaceId)}/conversations`,
      ),
    /** A group chat: public to the Space, with everyone in the Space in it. */
    createConversation: (spaceId: string, title: string) =>
      request<SpaceConversation>(`/spaces/${encodeURIComponent(spaceId)}/conversations`, {
        method: "POST",
        body: JSON.stringify({ title }),
      }),
    /** The DM with another person in the Space, visible only to the two of you. */
    openDirectMessage: (spaceId: string, userId: string) =>
      request<SpaceConversation>(`/spaces/${encodeURIComponent(spaceId)}/conversations/dm`, {
        method: "POST",
        body: JSON.stringify({ user_id: userId }),
      }),
    updateConversation: (spaceId: string, conversationId: string, title: string) =>
      request<SpaceConversation>(
        `/spaces/${encodeURIComponent(spaceId)}/conversations/${encodeURIComponent(conversationId)}`,
        { method: "PATCH", body: JSON.stringify({ title }) },
      ),
    deleteOrClearConversation: (spaceId: string, conversationId: string) =>
      deleteConversation(request, spaceId, conversationId),
    markConversationRead: (spaceId: string, conversationId: string, seq: number) =>
      request(
        `/spaces/${encodeURIComponent(spaceId)}/conversations/${encodeURIComponent(conversationId)}/read`,
        { method: "POST", body: JSON.stringify({ seq }) },
      ),
    /** A page of a conversation; `onCached` paints the saved copy of it first, when there is one. */
    conversationMessages: (
      spaceId: string,
      conversationId: string,
      before = 0,
      onCached?: (value: { messages: SpaceMessage[] }) => void,
    ) =>
      request<{ messages: SpaceMessage[] }>(
        `/spaces/${encodeURIComponent(spaceId)}/conversations/${encodeURIComponent(conversationId)}/messages?before=${before}&limit=${spaceMessagePageSize}`,
        { onCached },
      ),
    sendConversationMessage: (
      spaceId: string,
      conversationId: string,
      content: MessageSpan[],
      fileNodeIds: string[] = [],
      attachmentIds: string[] = [],
      libraryItemIds: string[] = [],
      replyToMessageId = "",
      clientNonce = "",
      inputModality: "text" | "voice" = "text",
    ) =>
      request<{
        message: SpaceMessage;
      }>(
        `/spaces/${encodeURIComponent(spaceId)}/conversations/${encodeURIComponent(conversationId)}/messages`,
        {
          method: "POST",
          body: JSON.stringify({
            content,
            file_node_ids: fileNodeIds,
            attachment_ids: attachmentIds,
            library_item_ids: libraryItemIds,
            reply_to_message_id: replyToMessageId,
            client_nonce: clientNonce,
            input_modality: inputModality,
          }),
        },
      ),
    updateConversationMessage: (
      spaceId: string,
      conversationId: string,
      messageId: string,
      content: MessageSpan[],
      fileNodeIds: string[] = [],
    ) =>
      request<SpaceMessage>(messagePath(spaceId, conversationId, messageId), {
        method: "PUT",
        body: JSON.stringify({ content, file_node_ids: fileNodeIds }),
      }),
    deleteConversationMessage: (spaceId: string, conversationId: string, messageId: string) =>
      request(messagePath(spaceId, conversationId, messageId), { method: "DELETE" }),
    addConversationMessageReaction: reactionRequest(request, "PUT"),
    removeConversationMessageReaction: reactionRequest(request, "DELETE"),
  };
}

function deleteConversation(request: SpaceRequest, spaceId: string, conversationId: string) {
  return request(
    `/spaces/${encodeURIComponent(spaceId)}/conversations/${encodeURIComponent(conversationId)}`,
    { method: "DELETE" },
  );
}

function messagePath(spaceId: string, conversationId: string, messageId: string): string {
  return `/spaces/${encodeURIComponent(spaceId)}/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`;
}

function reactionRequest(request: SpaceRequest, method: "PUT" | "DELETE") {
  return (spaceId: string, conversationId: string, messageId: string, emoji: string) =>
    request<SpaceMessage>(
      `${messagePath(spaceId, conversationId, messageId)}/reactions/${encodeURIComponent(emoji)}`,
      { method },
    );
}
