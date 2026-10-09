import { apiRequest } from "@/api/client";

export interface FrontierModel {
  id: string;
  name: string;
  provider_id: string;
  provider_name: string;
  capabilities: string[];
  reasoning_levels: Array<"default" | "low" | "medium" | "high" | "xhigh">;
}

export interface FrontierModelCatalog {
  catalog_version: string;
  default_model_id: string;
  models: FrontierModel[];
}

export const assistantApi = {
  search: <T>(query: string, limit = 40, filters?: { kinds?: string[]; spaceId?: string }) => {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    if (filters?.kinds?.length) params.set("kinds", filters.kinds.join(","));
    if (filters?.spaceId) params.set("space_id", filters.spaceId);
    return apiRequest<{
      hits: T[];
      cursor?: string;
      request_id?: string;
      semantic_enrichment_used?: boolean;
    }>(`/search/global?${params.toString()}`);
  },
  visualSearch: <T>(attachmentId: string, query = "", limit = 40, spaceId?: string) =>
    apiRequest<{ hits: T[]; request_id: string; semantic_enrichment_used: boolean }>(
      "/search/global/visual",
      {
        method: "POST",
        body: JSON.stringify({ attachment_id: attachmentId, query, limit, space_id: spaceId }),
      },
    ),
  conversations: <T>(query = "") =>
    apiRequest<{ conversations: T[] }>(
      `/misty/conversations${query ? `?q=${encodeURIComponent(query)}` : ""}`,
    ),
  createConversation: <T>(title: string, spaceId?: string, agentId?: string) =>
    apiRequest<T>("/misty/conversations", {
      method: "POST",
      body: JSON.stringify({ title, space_id: spaceId, agent_id: agentId }),
    }),
  deleteConversation: (conversationId: string) =>
    apiRequest(`/misty/conversations/${encodeURIComponent(conversationId)}`, {
      method: "DELETE",
    }),
  renameConversation: (conversationId: string, title: string) =>
    apiRequest<{ id: string; title: string }>(
      `/misty/conversations/${encodeURIComponent(conversationId)}`,
      { method: "PATCH", body: JSON.stringify({ title }) },
    ),
  bindConversationSpace: (conversationId: string, spaceId: string) =>
    apiRequest<{ id: string; spaceId: string }>(
      `/misty/conversations/${encodeURIComponent(conversationId)}`,
      { method: "PATCH", body: JSON.stringify({ space_id: spaceId }) },
    ),
  updateConversationSettings: (
    conversationId: string,
    settings: { thinking_mode: "normal" | "deep" },
  ) =>
    apiRequest<{ id: string; model_id: string; reasoning_effort: string }>(
      `/misty/conversations/${encodeURIComponent(conversationId)}`,
      { method: "PATCH", body: JSON.stringify(settings) },
    ),
  /** Pins a conversation's model; an empty model follows the account's Thinking choice. */
  updateConversationModel: (conversationId: string, model: string) =>
    apiRequest<{ id: string; model_override: string }>(
      `/misty/conversations/${encodeURIComponent(conversationId)}`,
      { method: "PATCH", body: JSON.stringify({ model_id: model }) },
    ),
  frontierModels: () => apiRequest<FrontierModelCatalog>("/ai/models"),
  complete: (prompt: string) =>
    apiRequest<{ text: string }>("/ai/complete", {
      method: "POST",
      body: JSON.stringify({
        prompt,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
      }),
    }),
};
