import { usePersonalAgentsStore } from "@/features/agents/personalAgentsStore";
import type { MistyState } from "./mistyState";

/** The open conversation a prompt continues, or undefined when it needs a new one. */
export function currentConversationForPrompt(
  state: Pick<MistyState, "conversations" | "activeConversationId" | "selectedAgentId">,
): string | undefined {
  const current = state.conversations.find((item) => item.id === state.activeConversationId);
  const defaultAgent = usePersonalAgentsStore
    .getState()
    .agents.find((agent) => agent.system_managed)?.id;
  const differentAgent =
    state.selectedAgentId &&
    (current?.agentId
      ? current.agentId !== state.selectedAgentId
      : state.selectedAgentId !== defaultAgent);
  return !current || differentAgent ? undefined : current.id;
}

/** New work is personal. Conversation and agent ownership are account-scoped;
 * content destinations never change the conversation identity. */
export async function conversationForGlobalPrompt(get: () => MistyState, _prompt: string) {
  const state = get();
  const current = currentConversationForPrompt(state);
  if (current) return current;
  return state.selectedAgentId
    ? state.newConversation(undefined, state.selectedAgentId)
    : state.newConversation();
}
