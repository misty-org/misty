import { resolveMentionedAgentSpaceId } from "@/features/agents/agentSpaceSelection";
import { useAgentsSpaces as useSpacesStore } from "@/features/agents/agentsRuntime";

import type { GlobalSearchState } from "./globalSearchState";

export async function conversationForGlobalPrompt(get: () => GlobalSearchState, prompt: string) {
  const state = get();
  const spaces = useSpacesStore.getState().spaces;
  const current = state.conversations.find((item) => item.id === state.activeConversationId);
  const promptSpaceId = resolveMentionedAgentSpaceId(spaces, prompt);
  const contextSpaces = [...new Set(state.context.map((item) => item.spaceId).filter(Boolean))];
  if (contextSpaces.length > 1) throw new Error("Choose one Space for this request.");
  const contextualSpaceId = contextSpaces[0] ?? "";
  const targetSpaceId = promptSpaceId || contextualSpaceId || current?.spaceId || "";

  if (!current || (current.spaceId && targetSpaceId && current.spaceId !== targetSpaceId)) {
    return state.newConversation(targetSpaceId || undefined);
  }
  if (!current.spaceId && targetSpaceId) {
    await state.bindConversationSpace(current.id, targetSpaceId);
  }
  return current.id;
}
