import type {
  SpaceMessage,
  SpaceRun,
  SpaceRunDetail,
} from "@/api/spaces/dto/interfaces/types";
import type { MessageSpan } from "@/api/spaces/dto/types/types";

import type { SpaceRequest } from "./types";

export function createSpaceChatApi(request: SpaceRequest) {
  return {
    messages: (spaceId: string, before = 0) =>
      request<{ messages: SpaceMessage[] }>(
        `/spaces/${encodeURIComponent(spaceId)}/messages?before=${before}&limit=50`,
      ),
    sendMessage: (
      spaceId: string,
      content: MessageSpan[],
      fileNodeIds: string[] = [],
      attachmentIds: string[] = [],
      libraryItemIds: string[] = [],
      replyToMessageId = "",
      clientNonce = "",
    ) =>
      request<{
        message: SpaceMessage;
      }>(`/spaces/${encodeURIComponent(spaceId)}/messages`, {
        method: "POST",
        body: JSON.stringify({
          content,
          file_node_ids: fileNodeIds,
          attachment_ids: attachmentIds,
          library_item_ids: libraryItemIds,
          reply_to_message_id: replyToMessageId,
          client_nonce: clientNonce,
        }),
      }),
    runDetail: (runId: string) => request<SpaceRunDetail>(`/runs/${encodeURIComponent(runId)}`),
    decideRun: (runId: string, approved: boolean) =>
      request<SpaceRun>(`/runs/${encodeURIComponent(runId)}/approval`, {
        method: "POST",
        body: JSON.stringify({ approved }),
      }),
    cancelRun: (runId: string) =>
      request<SpaceRun>(`/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" }),
    retryRun: (runId: string) =>
      request<SpaceRun>(`/runs/${encodeURIComponent(runId)}/retry`, { method: "POST" }),
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
