import { assistantApi, safeAssistantTurnInput } from "@/api/assistant/api";
import type {
  GlobalAiActionProposal,
  GlobalAiCitation,
  GlobalAiContextRef,
  GlobalAiConversation,
  GlobalAiMessage,
  GlobalAiMode,
  GlobalSearchDocument,
} from "./types";

interface TurnResponse {
  conversation?: GlobalAiConversation;
  message?: GlobalAiMessage;
  text?: string;
  citations?: GlobalAiCitation[];
  action?: GlobalAiActionProposal;
}

export const globalMistyApi = {
  search: (query: string, limit = 40) => assistantApi.search<GlobalSearchDocument>(query, limit),
  conversations: (query = "") => assistantApi.conversations<GlobalAiConversation>(query),
  createConversation: (title: string) =>
    assistantApi.createConversation<GlobalAiConversation>(title),
  deleteConversation: assistantApi.deleteConversation,
  turn: (
    conversationId: string,
    input: {
      mode: Exclude<GlobalAiMode, "search">;
      prompt: string;
      context: GlobalAiContextRef[];
      agentId?: string;
    },
  ) => assistantApi.turn<TurnResponse, GlobalAiContextRef>(conversationId, input),
  complete: assistantApi.complete,
  delegate: (proposal: GlobalAiActionProposal) =>
    assistantApi.delegate<{
      status: string;
      trace?: string;
      run?: { id: string; state: string; error_message?: string };
    }>(proposal),
  decideProposal: (proposalId: string, approved: boolean) =>
    assistantApi.decideProposal<GlobalAiActionProposal>(proposalId, approved),
};

export function aiSafeTurnInput(input: {
  mode: Exclude<GlobalAiMode, "search">;
  prompt: string;
  context: GlobalAiContextRef[];
  agentId?: string;
}) {
  return safeAssistantTurnInput(input);
}
