import { pendingQuestionSet, useCollaborationStore } from "./store";
import { useConversationCollaboration } from "./use_conversation_collaboration";

const commandPattern = /^\/plan(?:\s+([\s\S]*))?$/;

export function useCollaborationComposer(input: {
  accountId: string;
  conversationId?: string;
  clearDraft(): void;
}) {
  const { state, mode } = useConversationCollaboration(input.accountId, input.conversationId);
  const planning = mode === "plan";
  const command = async (typed: string): Promise<string | undefined> => {
    const match = commandPattern.exec(typed.trim());
    if (!match) return typed;
    const rest = match[1]?.trim() ?? "";
    await useCollaborationStore.getState().setMode(input.conversationId, "plan");
    if (rest) return rest;
    input.clearDraft();
    return undefined;
  };
  return {
    state,
    mode,
    planning,
    questions: pendingQuestionSet(state),
    proposedPlan: state?.plan?.state === "proposed" ? state.plan : undefined,
    command,
  };
}
