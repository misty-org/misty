import { runtimeAssistantApi as assistantApi } from "@/features/agents/agentsRuntime";
import { safeAssistantTurnInput } from "@/api/assistant/api-core";
import type {
  GlobalAiActionProposal,
  GlobalAiCitation,
  GlobalAiContextRef,
  GlobalAiConversation,
  GlobalAiMessage,
  GlobalAiMode,
  GlobalSearchDocument,
  GlobalSearchFilters,
  GlobalSearchResult,
} from "./types";

interface TurnResponse {
  conversation?: GlobalAiConversation;
  message?: GlobalAiMessage;
  text?: string;
  citations?: GlobalAiCitation[];
  action?: GlobalAiActionProposal;
}

export const globalMistyApi = {
  search: (query: string, filters?: GlobalSearchFilters, limit = 40) =>
    assistantApi.search<GlobalSearchDocument>(query, limit, {
      kinds: filters?.kinds,
      spaceId: filters?.spaceId,
    }),
  visualSearch: (attachmentId: string, query = "", limit = 40) =>
    assistantApi.visualSearch<GlobalSearchResult>(attachmentId, query, limit),
  conversations: (query = "") => assistantApi.conversations<GlobalAiConversation>(query),
  createConversation: (title: string, spaceId?: string) =>
    assistantApi.createConversation<GlobalAiConversation>(title, spaceId),
  deleteConversation: assistantApi.deleteConversation,
  renameConversation: assistantApi.renameConversation,
  bindConversationSpace: assistantApi.bindConversationSpace,
  turn: (
    conversationId: string,
    input: {
      mode: Exclude<GlobalAiMode, "search">;
      prompt: string;
      context: GlobalAiContextRef[];
    },
  ) => assistantApi.turn<TurnResponse, GlobalAiContextRef>(conversationId, input),
  complete: assistantApi.complete,
  decideProposal: (proposalId: string, approved: boolean) =>
    assistantApi.decideProposal<GlobalAiActionProposal>(proposalId, approved),
};

export function aiSafeTurnInput(input: {
  mode: Exclude<GlobalAiMode, "search">;
  prompt: string;
  context: GlobalAiContextRef[];
}) {
  return safeAssistantTurnInput(input);
}
