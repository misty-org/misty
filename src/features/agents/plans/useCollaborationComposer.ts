import { pendingQuestionSet, useCollaborationStore } from "./store";
import { useConversationCollaboration } from "./useConversationCollaboration";

const commandPattern = /^\/plan(?:\s+([\s\S]*))?$/;

/**
 * The composer's side of collaboration: the conversation's mode, open questions
 * and proposed plan; the /plan command; and Shift+Tab.
 */
export function useCollaborationComposer(input: {
  accountId: string;
  conversationId?: string;
  clearDraft(): void;
}) {
  const { state, mode } = useConversationCollaboration(input.accountId, input.conversationId);
  const planning = mode === "plan";
  const toggleMode = () =>
    void useCollaborationStore.getState().setMode(input.conversationId, planning ? "act" : "plan");
  /**
   * Runs /plan. Returns the text to send instead, or undefined when the command was handled:
   * /plan switches to Plan mode and sends what follows it.
   */
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
    toggleMode,
  };
}
