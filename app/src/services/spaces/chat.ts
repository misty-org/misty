import type {
  SpaceAgentMembership,
  SpaceMessage,
  SpaceRun,
  SpaceRunDetail,
} from "@/services/spaces/dto/interfaces/types";
import type { MessageSpan } from "@/services/spaces/dto/types/types";

import type { SpaceRequest } from "./types";

export function createSpaceChatApi(request: SpaceRequest) {
  return {
    messages: (spaceId: string, before = 0) =>
      request<{ messages: SpaceMessage[] }>(
        `/spaces/${encodeURIComponent(spaceId)}/messages?before=${before}&limit=50`,
      ),
    chatAgents: (spaceId: string) =>
      request<{ agents: SpaceAgentMembership[] }>(
        `/spaces/${encodeURIComponent(spaceId)}/agents`,
      ).then(({ agents }) => ({
        agents: agents
          .filter((agent) => agent.enabled)
          .map((agent) => ({
            id: agent.agent_id,
            space_id: agent.space_id,
            creator_user_id: agent.owner_user_id,
            kind: "agent" as const,
            name: agent.name,
            description: agent.description,
            icon: agent.icon,
            model_id: agent.model_id,
            enabled: agent.enabled,
            status: agent.work_state,
            version: agent.approved_version,
            schedules_enabled: false,
            created_at: agent.created_at,
            updated_at: agent.updated_at,
          })),
      })),
    sendMessage: (
      spaceId: string,
      content: MessageSpan[],
      fileNodeIds: string[] = [],
      attachmentIds: string[] = [],
      libraryItemIds: string[] = [],
      replyToMessageId = "",
    ) =>
      request<{
        message: SpaceMessage;
        triggered_runs: Array<{
          id: string;
          agent_id: string;
          state:
            | "queued"
            | "working"
            | "awaiting_approval"
            | "completed"
            | "failed"
            | "canceled"
            | "retrying";
        }>;
      }>(`/spaces/${encodeURIComponent(spaceId)}/messages`, {
        method: "POST",
        body: JSON.stringify({
          content,
          file_node_ids: fileNodeIds,
          attachment_ids: attachmentIds,
          library_item_ids: libraryItemIds,
          reply_to_message_id: replyToMessageId,
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
