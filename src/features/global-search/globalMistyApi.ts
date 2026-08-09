import { spaceRequest } from "@/services/spaces/api";
import type {
  GlobalAiActionProposal,
  GlobalAiCitation,
  GlobalAiContextRef,
  GlobalAiConversation,
  GlobalAiMessage,
  GlobalAiMode,
  GlobalSearchDocument,
} from "./types";

interface GlobalSearchResponse {
  hits: GlobalSearchDocument[];
  cursor?: string;
}

interface ConversationResponse {
  conversations: GlobalAiConversation[];
}

interface TurnResponse {
  conversation?: GlobalAiConversation;
  message?: GlobalAiMessage;
  text?: string;
  citations?: GlobalAiCitation[];
  action?: GlobalAiActionProposal;
}

export const globalMistyApi = {
  search: (query: string, limit = 40) =>
    spaceRequest<GlobalSearchResponse>(
      `/search/global?q=${encodeURIComponent(query)}&limit=${limit}`,
    ),
  conversations: (query = "") =>
    spaceRequest<ConversationResponse>(
      `/misty/conversations${query ? `?q=${encodeURIComponent(query)}` : ""}`,
    ),
  createConversation: (title: string) =>
    spaceRequest<GlobalAiConversation>("/misty/conversations", {
      method: "POST",
      body: JSON.stringify({ title }),
    }),
  deleteConversation: (conversationId: string) =>
    spaceRequest(`/misty/conversations/${encodeURIComponent(conversationId)}`, {
      method: "DELETE",
    }),
  turn: (
    conversationId: string,
    input: {
      mode: Exclude<GlobalAiMode, "search">;
      prompt: string;
      context: GlobalAiContextRef[];
      agentId?: string;
    },
  ) =>
    spaceRequest<TurnResponse>(`/misty/conversations/${encodeURIComponent(conversationId)}/turns`, {
      method: "POST",
      body: JSON.stringify(aiSafeTurnInput(input)),
    }),
  complete: (prompt: string) =>
    spaceRequest<{ text: string }>("/ai/complete", {
      method: "POST",
      body: JSON.stringify({ prompt }),
    }),
  delegate: (proposal: GlobalAiActionProposal) =>
    spaceRequest<{
      status: string;
      trace?: string;
      run?: { id: string; state: string; error_message?: string };
    }>("/agents/delegate", {
      method: "POST",
      headers: { "Idempotency-Key": proposal.id },
      body: JSON.stringify({
        prompt: proposal.prompt,
        space_id: proposal.spaceId ?? "",
        agent_id: proposal.agentId ?? "",
      }),
    }),
  decideProposal: (proposalId: string, approved: boolean) =>
    spaceRequest<GlobalAiActionProposal>(
      `/misty/action-proposals/${encodeURIComponent(proposalId)}/decision`,
      { method: "POST", body: JSON.stringify({ approved }) },
    ),
};

export function aiSafeTurnInput(input: {
  mode: Exclude<GlobalAiMode, "search">;
  prompt: string;
  context: GlobalAiContextRef[];
  agentId?: string;
}) {
  return {
    mode: input.mode,
    prompt: input.prompt,
    context: input.context.map(({ localPath: _localPath, ...reference }) => reference),
    ...(input.agentId ? { agent_id: input.agentId } : {}),
  };
}
