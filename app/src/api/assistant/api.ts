import { apiRequest } from "@/api/client";

export interface AssistantTurnInput<TContext extends object = Record<string, unknown>> {
  mode: string;
  prompt: string;
  context: TContext[];
  agentId?: string;
}

export interface AssistantActionInput {
  id: string;
  prompt: string;
  spaceId?: string;
  agentId?: string;
}

export const assistantApi = {
  search: <T>(query: string, limit = 40) =>
    apiRequest<{ hits: T[]; cursor?: string }>(
      `/search/global?q=${encodeURIComponent(query)}&limit=${limit}`,
    ),
  conversations: <T>(query = "") =>
    apiRequest<{ conversations: T[] }>(
      `/misty/conversations${query ? `?q=${encodeURIComponent(query)}` : ""}`,
    ),
  createConversation: <T>(title: string) =>
    apiRequest<T>("/misty/conversations", {
      method: "POST",
      body: JSON.stringify({ title }),
    }),
  deleteConversation: (conversationId: string) =>
    apiRequest(`/misty/conversations/${encodeURIComponent(conversationId)}`, {
      method: "DELETE",
    }),
  turn: <T, TContext extends object>(conversationId: string, input: AssistantTurnInput<TContext>) =>
    apiRequest<T>(`/misty/conversations/${encodeURIComponent(conversationId)}/turns`, {
      method: "POST",
      body: JSON.stringify(safeAssistantTurnInput(input)),
    }),
  complete: (prompt: string) =>
    apiRequest<{ text: string }>("/ai/complete", {
      method: "POST",
      body: JSON.stringify({ prompt }),
    }),
  delegate: <T>(proposal: AssistantActionInput) =>
    apiRequest<T>("/agents/delegate", {
      method: "POST",
      headers: { "Idempotency-Key": proposal.id },
      body: JSON.stringify({
        prompt: proposal.prompt,
        space_id: proposal.spaceId ?? "",
        agent_id: proposal.agentId ?? "",
      }),
    }),
  decideProposal: <T>(proposalId: string, approved: boolean) =>
    apiRequest<T>(`/misty/action-proposals/${encodeURIComponent(proposalId)}/decision`, {
      method: "POST",
      body: JSON.stringify({ approved }),
    }),
};

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
    ...(input.agentId ? { agent_id: input.agentId } : {}),
  };
}
