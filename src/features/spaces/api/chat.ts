import type { SpaceMessage, SpaceThread } from "./dto/entities";
import type { MessageSpan } from "./dto/common";

import type { SpaceRequest } from "./spaceRequestTypes";

/** How many messages a chat reads at once: its newest page, then each older one as it scrolls back. */
export const spaceMessagePageSize = 50;

export function createSpaceChatApi(request: SpaceRequest) {
  return {
    messages: (
      spaceId: string,
      before = 0,
      onCached?: (value: { messages: SpaceMessage[] }) => void,
    ) =>
      request<{ messages: SpaceMessage[] }>(
        `/spaces/${encodeURIComponent(spaceId)}/messages?before=${before}&limit=${spaceMessagePageSize}`,
        { onCached },
      ),
    sendMessage: (
      spaceId: string,
      content: MessageSpan[],
      fileNodeIds: string[] = [],
      attachmentIds: string[] = [],
      replyToMessageId = "",
      clientNonce = "",
      threadRootId = "",
    ) =>
      request<{
        message: SpaceMessage;
      }>(`/spaces/${encodeURIComponent(spaceId)}/messages`, {
        method: "POST",
        body: JSON.stringify({
          content,
          file_node_ids: fileNodeIds,
          attachment_ids: attachmentIds,
          reply_to_message_id: replyToMessageId,
          thread_root_id: threadRootId,
          client_nonce: clientNonce,
        }),
      }),
    /** A thread's newest replies, oldest first; pass the first visible seq to read older replies. */
    threadReplies: (spaceId: string, rootId: string, before = 0) =>
      request<{ messages: SpaceMessage[]; has_older: boolean }>(
        `/spaces/${encodeURIComponent(spaceId)}/messages/${encodeURIComponent(rootId)}/replies?before=${before}&limit=50`,
      ),
    markThreadRead: (spaceId: string, rootId: string, seq = 0) =>
      request(
        `/spaces/${encodeURIComponent(spaceId)}/messages/${encodeURIComponent(rootId)}/thread/read`,
        { method: "POST", body: JSON.stringify({ seq }) },
      ),
    /** The threads the person follows in the Space, most recently replied to first. */
    threads: (spaceId: string) =>
      request<{ threads: SpaceThread[] }>(`/spaces/${encodeURIComponent(spaceId)}/threads`),
    updateMessage: (
      spaceId: string,
      messageId: string,
      content: MessageSpan[],
      fileNodeIds: string[] = [],
    ) =>
      request<SpaceMessage>(
        `/spaces/${encodeURIComponent(spaceId)}/messages/${encodeURIComponent(messageId)}`,
        { method: "PUT", body: JSON.stringify({ content, file_node_ids: fileNodeIds }) },
      ),
    deleteMessage: (spaceId: string, messageId: string) =>
      request(`/spaces/${encodeURIComponent(spaceId)}/messages/${encodeURIComponent(messageId)}`, {
        method: "DELETE",
      }),
    addMessageReaction: (spaceId: string, messageId: string, emoji: string) =>
      request<SpaceMessage>(
        `/spaces/${encodeURIComponent(spaceId)}/messages/${encodeURIComponent(messageId)}/reactions/${encodeURIComponent(emoji)}`,
        { method: "PUT" },
      ),
    removeMessageReaction: (spaceId: string, messageId: string, emoji: string) =>
      request<SpaceMessage>(
        `/spaces/${encodeURIComponent(spaceId)}/messages/${encodeURIComponent(messageId)}/reactions/${encodeURIComponent(emoji)}`,
        { method: "DELETE" },
      ),
    markRead: (spaceId: string, seq: number) =>
      request(`/spaces/${encodeURIComponent(spaceId)}/read`, {
        method: "POST",
        body: JSON.stringify({ seq }),
      }),
  };
}
