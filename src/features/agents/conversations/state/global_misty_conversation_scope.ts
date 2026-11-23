import { defaultAgentOf, usePersonalAgentsStore } from "../../personal/personal_agents_store";
import { adoptDraftChat } from "./draft_chat";
import type { MistyState } from "./misty_state";

export function currentConversationForPrompt(
  state: Pick<MistyState, "conversations" | "activeConversationId" | "selectedAgentId">,
): string | undefined {
  const current = state.conversations.find((item) => item.id === state.activeConversationId);
  const defaultAgent =
    usePersonalAgentsStore.getState().agents.find((agent) => agent.system_managed)?.id ??
    defaultAgentOf(usePersonalAgentsStore.getState().agents)?.id;
  const differentAgent =
    state.selectedAgentId &&
    (current?.agentId
      ? current.agentId !== state.selectedAgentId
      : state.selectedAgentId !== defaultAgent);
  return !current || differentAgent ? undefined : current.id;
}

export async function conversationForGlobalPrompt(get: () => MistyState, _prompt: string) {
  const state = get();
  const current = currentConversationForPrompt(state);
  if (current) return current;
  const created = await (state.selectedAgentId
    ? state.newConversation(undefined, state.selectedAgentId)
    : state.newConversation());
  adoptDraftChat(created);
  return created;
}
