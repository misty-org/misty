import { resolveMentionedAgentSpaceId } from "@/features/agents/agentSpaceSelection";
import { useAgentsSpaces as useSpacesStore } from "@/features/agents/agentsRuntime";

import type { GlobalSearchState } from "./globalSearchState";

export async function conversationForGlobalPrompt(get: () => GlobalSearchState, prompt: string) {
  const state = get();
  const spaces = useSpacesStore.getState().spaces;
  const current = state.conversations.find((item) => item.id === state.activeConversationId);
  const promptSpaceId = resolveMentionedAgentSpaceId(spaces, prompt);
  const recentUserContext = current?.messages
    .filter((message) => message.role === "user")
    .slice(-6)
    .map((message) => message.content)
    .join("\n");
  const mentionedSpaceId =
    promptSpaceId || resolveMentionedAgentSpaceId(spaces, recentUserContext ?? "");
  const contextualSpaceId = state.context.find((item) => item.spaceId)?.spaceId ?? "";
  const targetSpaceId = mentionedSpaceId || current?.spaceId || contextualSpaceId;

  if (!current || (current.spaceId && mentionedSpaceId && current.spaceId !== mentionedSpaceId)) {
    return state.newConversation(targetSpaceId || undefined);
  }
  if (!current.spaceId && targetSpaceId) {
    await state.bindConversationSpace(current.id, targetSpaceId);
  }
  return current.id;
}
