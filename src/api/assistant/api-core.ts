export interface FrontierModel {
  id: string;
  name: string;
  provider_id: string;
  provider_name: string;
  capabilities: string[];
  reasoning_levels: Array<"default" | "low" | "medium" | "high">;
}

export interface FrontierModelCatalog {
  catalog_version: string;
  default_model_id: string;
  models: FrontierModel[];
}

export interface AssistantTurnInput<TContext extends object = Record<string, unknown>> {
  mode: string;
  prompt: string;
  context: TContext[];
  timezone?: string;
}

export function createAssistantApi(
  apiRequest: <T = void>(path: string, init?: RequestInit) => Promise<T>,
  apiBlobRequest: (path: string) => Promise<Blob> = async () => {
    throw new Error("Use the binary operation.");
  },
) {
  return {
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
    visualSearch: <T>(attachmentId: string, query = "", limit = 40) =>
      apiRequest<{ hits: T[]; request_id: string; semantic_enrichment_used: boolean }>(
        "/search/global/visual",
        { method: "POST", body: JSON.stringify({ attachment_id: attachmentId, query, limit }) },
      ),
    conversations: <T>(query = "") =>
      apiRequest<{ conversations: T[] }>(
        `/misty/conversations${query ? `?q=${encodeURIComponent(query)}` : ""}`,
      ),
    createConversation: <T>(title: string, spaceId?: string) =>
      apiRequest<T>("/misty/conversations", {
        method: "POST",
        body: JSON.stringify({ title, space_id: spaceId }),
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
      settings: { model_id: string; reasoning_effort: "" | "low" | "medium" | "high" },
    ) =>
      apiRequest<{ id: string; model_id: string; reasoning_effort: string }>(
        `/misty/conversations/${encodeURIComponent(conversationId)}`,
        { method: "PATCH", body: JSON.stringify(settings) },
      ),
    frontierModels: () => apiRequest<FrontierModelCatalog>("/ai/models"),
    turn: <T, TContext extends object>(
      conversationId: string,
      input: AssistantTurnInput<TContext>,
    ) =>
      apiRequest<T>(`/misty/conversations/${encodeURIComponent(conversationId)}/turns`, {
        method: "POST",
        body: JSON.stringify(safeAssistantTurnInput(input)),
      }),
    complete: (prompt: string) =>
      apiRequest<{ text: string }>("/ai/complete", {
        method: "POST",
        body: JSON.stringify({
          prompt,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
        }),
      }),
    decideProposal: <T>(proposalId: string, approved: boolean) =>
      apiRequest<T>(`/misty/action-proposals/${encodeURIComponent(proposalId)}/decision`, {
        method: "POST",
        body: JSON.stringify({ approved }),
      }),
  };
}

export function safeAssistantTurnInput<TContext extends object>(
  input: AssistantTurnInput<TContext>,
) {
  return {
    mode: input.mode,
    prompt: input.prompt,
    context: input.context.map((context) => {
      const { localPath: _localPath, ...reference } = context as TContext & { localPath?: string };
      return reference;
    }),
    timezone: input.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
  };
}
