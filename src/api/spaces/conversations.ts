import type {
  SpaceActorRef,
  SpaceConversation,
  SpaceMessage,
} from "@/api/spaces/dto/interfaces/types";
import type { MessageSpan } from "@/api/spaces/dto/types/types";

type SpaceRequest = <T = void>(path: string, init?: RequestInit) => Promise<T>;

export function createSpaceConversationsApi(request: SpaceRequest) {
  return {
    conversations: (spaceId: string) =>
      request<{ conversations: SpaceConversation[] }>(
        `/spaces/${encodeURIComponent(spaceId)}/conversations`,
      ),
    createConversation: (spaceId: string, title: string, participants: SpaceActorRef[]) =>
      request<SpaceConversation>(`/spaces/${encodeURIComponent(spaceId)}/conversations`, {
        method: "POST",
        body: JSON.stringify({ title, participants }),
      }),
    updateConversation: (
      spaceId: string,
      conversationId: string,
      title: string,
      participants: SpaceActorRef[],
    ) =>
      request<SpaceConversation>(
        `/spaces/${encodeURIComponent(spaceId)}/conversations/${encodeURIComponent(conversationId)}`,
        { method: "PATCH", body: JSON.stringify({ title, participants }) },
      ),
    deleteDisconnectedConversation: (spaceId: string, conversationId: string) =>
      deleteConversation(request, spaceId, conversationId),
    deleteOrClearConversation: (spaceId: string, conversationId: string) =>
      deleteConversation(request, spaceId, conversationId),
    clearEveryoneConversation: (spaceId: string) =>
      request(`/spaces/${encodeURIComponent(spaceId)}/messages`, { method: "DELETE" }),
    markConversationRead: (spaceId: string, conversationId: string, seq: number) =>
      request(
        `/spaces/${encodeURIComponent(spaceId)}/conversations/${encodeURIComponent(conversationId)}/read`,
        { method: "POST", body: JSON.stringify({ seq }) },
      ),
    conversationMessages: (spaceId: string, conversationId: string, before = 0) =>
      request<{ messages: SpaceMessage[] }>(
        `/spaces/${encodeURIComponent(spaceId)}/conversations/${encodeURIComponent(conversationId)}/messages?before=${before}&limit=50`,
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
      directAgent?: {
        agentId: string;
        timezone?: string;
        contextNoteId?: string;
        contextReferences: Array<{
          device_id: string;
          kind: "browser_tab" | "project_root";
          opaque_ref: string;
          display_name?: string;
          capabilities: string[];
        }>;
      },
    ) =>
      request<{
        message: SpaceMessage;
        triggered_runs: Array<{ id: string; agent_id: string; state: string }>;
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
            agent_invocations: directAgent
              ? [
                  {
                    agent_id: directAgent.agentId,
                    timezone: directAgent.timezone,
                    context_note_id: directAgent.contextNoteId,
                    context_references: directAgent.contextReferences,
                  },
                ]
              : agentInvocations(content),
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

function agentInvocations(content: MessageSpan[]) {
  const ids = new Set<string>();
  for (const span of content) {
    if (span.type === "mention" && "agent_id" in span && span.agent_id) ids.add(span.agent_id);
  }
  return [...ids].map((agent_id) => ({ agent_id }));
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
