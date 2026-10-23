import { runtimeAssistantApi as assistantApi } from "@/features/agents/AgentsRuntime";
import type { GlobalAiConversation } from "./types";

export const globalMistyApi = {
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
  complete: assistantApi.complete,
};
