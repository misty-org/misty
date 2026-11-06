import { runtimeAssistantApi as assistantApi } from "@/features/agents/AgentsRuntime";
import type { GlobalAiConversation } from "./types";

export const globalMistyApi = {
  conversations: (
    query = "",
    onCached?: (value: { conversations: GlobalAiConversation[] }) => void,
  ) => assistantApi.conversations<GlobalAiConversation>(query, onCached),
  createConversation: (title: string, spaceId?: string, agentId?: string) =>
    assistantApi.createConversation<GlobalAiConversation>(title, spaceId, agentId),
  dropTurns: assistantApi.dropTurns,
  moveTurn: assistantApi.moveTurn,
  saveLedger: assistantApi.saveLedger,
  markConversationRead: assistantApi.markConversationRead,
  deleteConversation: assistantApi.deleteConversation,
  renameConversation: assistantApi.renameConversation,
  complete: assistantApi.complete,
};
