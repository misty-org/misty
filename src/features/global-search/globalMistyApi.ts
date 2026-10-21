import { runtimeAssistantApi as assistantApi } from "@/features/agents/AgentsRuntime";
import type {
  GlobalAiConversation,
  GlobalSearchDocument,
  GlobalSearchFilters,
  GlobalSearchResult,
} from "./types";

export const globalMistyApi = {
  search: (query: string, filters?: GlobalSearchFilters, limit = 40) =>
    assistantApi.search<GlobalSearchDocument>(query, limit, {
      kinds: filters?.kinds,
      spaceId: filters?.spaceId,
    }),
  visualSearch: (attachmentId: string, query = "", limit = 40, spaceId?: string) =>
    assistantApi.visualSearch<GlobalSearchResult>(attachmentId, query, limit, spaceId),
  conversations: (
    query = "",
    onCached?: (value: { conversations: GlobalAiConversation[] }) => void,
  ) => assistantApi.conversations<GlobalAiConversation>(query, onCached),
  createConversation: (title: string, spaceId?: string, agentId?: string, deviceId?: string) =>
    assistantApi.createConversation<GlobalAiConversation>(title, spaceId, agentId, deviceId),
  conversationsInScope: (scope: "legacy" | "device", deviceId = "") =>
    assistantApi.conversationsInScope<GlobalAiConversation>(scope, deviceId),
  keepConversationOnDevice: assistantApi.keepConversationOnDevice,
  deleteConversation: assistantApi.deleteConversation,
  renameConversation: assistantApi.renameConversation,
  bindConversationSpace: assistantApi.bindConversationSpace,
  complete: assistantApi.complete,
};
