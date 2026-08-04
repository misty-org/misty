import type {
  SpaceActionSuggestionBatch,
  SpaceActionSuggestionSettings,
  SpaceAgentMembership,
  SpaceRun,
} from "@/models/interfaces/features/spaces/types";

type SpaceRequest = <T = void>(path: string, init?: RequestInit) => Promise<T>;

export function createSpaceActionSuggestionsApi(request: SpaceRequest) {
  const base = (spaceId: string) => `/spaces/${encodeURIComponent(spaceId)}`;
  return {
    actionSuggestionSettings: (spaceId: string) =>
      request<SpaceActionSuggestionSettings>(`${base(spaceId)}/action-suggestion-settings`),
    updateActionSuggestionSettings: (spaceId: string, enabled: boolean) =>
      request<SpaceActionSuggestionSettings>(`${base(spaceId)}/action-suggestion-settings`, {
        method: "PUT",
        body: JSON.stringify({ enabled }),
      }),
    actionSuggestions: (spaceId: string) =>
      request<{ suggestions: SpaceActionSuggestionBatch[] }>(`${base(spaceId)}/action-suggestions`),
    actionSuggestionReview: (spaceId: string, batchId: string) =>
      request<{
        suggestion: SpaceActionSuggestionBatch;
        eligible_agents: SpaceAgentMembership[];
        eligible_agents_by_item: Record<string, SpaceAgentMembership[]>;
        destination_audience: { kind: "space" | "conversation"; conversation_id?: string };
      }>(`${base(spaceId)}/action-suggestions/${encodeURIComponent(batchId)}/review`),
    dismissActionSuggestion: (spaceId: string, batchId: string) =>
      request(`${base(spaceId)}/action-suggestions/${encodeURIComponent(batchId)}/dismiss`, {
        method: "POST",
      }),
    acceptActionSuggestion: (
      spaceId: string,
      batchId: string,
      version: number,
      items: Array<{
        item_id: string;
        selected_agent_id: string;
        approved_input: Record<string, unknown>;
      }>,
    ) =>
      request<{
        suggestion: SpaceActionSuggestionBatch;
        runs: SpaceRun[];
        follow_ups: Array<{ id: string; state: string }>;
      }>(`${base(spaceId)}/action-suggestions/${encodeURIComponent(batchId)}/accept`, {
        method: "POST",
        body: JSON.stringify({ version, items }),
      }),
    setConversationSuggestionVeto: (spaceId: string, conversationId: string, veto: boolean) =>
      request(
        `${base(spaceId)}/conversations/${encodeURIComponent(conversationId)}/action-suggestion-veto`,
        { method: veto ? "PUT" : "DELETE" },
      ),
    conversationSuggestionVeto: (spaceId: string, conversationId: string) =>
      request<{ veto: boolean }>(
        `${base(spaceId)}/conversations/${encodeURIComponent(conversationId)}/action-suggestion-veto`,
      ),
  };
}
