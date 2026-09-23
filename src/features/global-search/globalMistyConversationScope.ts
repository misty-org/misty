import { usePersonalAgentsStore } from "@/features/agents/personalAgentsStore";
import type { GlobalSearchState } from "./globalSearchState";

/** New work is personal. Only an explicitly reopened conversation retains its
 * historical server scope; prompt wording never changes that scope. */
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
  if (state.context.some((ref) => ref.spaceId && ref.spaceId !== current.spaceId))
    throw new Error(
      "Historical context belongs to another conversation. Reopen that conversation or remove the attachment.",
    );
  return current.id;
}
