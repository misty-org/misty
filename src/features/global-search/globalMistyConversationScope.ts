import { usePersonalAgentsStore } from "@/features/agents/personalAgentsStore";
import type { GlobalSearchState } from "./globalSearchState";

/** New work is personal. Conversation and agent ownership are account-scoped;
 * content destinations never change the conversation identity. */
export async function conversationForGlobalPrompt(get: () => GlobalSearchState, _prompt: string) {
  const state = get();
  const current = state.conversations.find((item) => item.id === state.activeConversationId);
  const defaultAgent = usePersonalAgentsStore
    .getState()
    .agents.find((agent) => agent.system_managed)?.id;
  const differentAgent =
    state.selectedAgentId &&
    (current?.agentId
      ? current.agentId !== state.selectedAgentId
      : state.selectedAgentId !== defaultAgent);
  if (!current || differentAgent) return state.newConversation();
  return current.id;
}
