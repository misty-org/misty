import { useEffect } from "react";
import { useStableCallback } from "@/shared/hooks/useStableCallback";
import { pendingQuestionSet, useCollaborationStore } from "./store";
import { useConversationCollaboration } from "./useConversationCollaboration";

const commandPattern = /^\/(plan|goal)(?:\s+([\s\S]*))?$/;

/**
 * The composer's side of collaboration: the conversation's mode, open questions
 * and proposed plan; the /plan and /goal commands; Shift+Tab; and turns other
 * surfaces queued (starting or resuming a goal), sent once the agent is idle.
 */
export function useCollaborationComposer(input: {
  accountId: string;
  conversationId?: string;
  working: boolean;
  /** The composer's normal send, into a given conversation. */
  send(prompt: string, conversationId?: string): void;
  /** The open conversation, created first when there is none yet. */
  ensureConversation(): Promise<string>;
  clearDraft(): void;
  reportError(message: string): void;
}) {
  const { state, mode } = useConversationCollaboration(input.accountId, input.conversationId);
  const planning = mode === "plan";
  const send = useStableCallback(input.send);
  const queuedTurn = useCollaborationStore((s) => s.queuedTurn);
  useEffect(() => {
    if (!queuedTurn || input.working || queuedTurn.conversationId !== input.conversationId) return;
    useCollaborationStore.getState().takeTurn(queuedTurn.nonce);
    send(queuedTurn.prompt, queuedTurn.conversationId);
  }, [queuedTurn, input.working, input.conversationId, send]);
  const toggleMode = () =>
    void useCollaborationStore.getState().setMode(input.conversationId, planning ? "act" : "plan");
  /**
   * Runs /plan and /goal. Returns the text to send instead, or undefined when the
   * command was handled: /plan switches to Plan mode and sends what follows it;
   * /goal sets a goal and starts working toward it.
   */
  const command = async (typed: string): Promise<string | undefined> => {
    const match = commandPattern.exec(typed.trim());
    if (!match) return typed;
    const rest = match[2]?.trim() ?? "";
    if (match[1] === "plan") {
      await useCollaborationStore.getState().setMode(input.conversationId, "plan");
      if (rest) return rest;
      input.clearDraft();
      return undefined;
    }
    if (!rest) {
      input.reportError(
        "Type the goal after /goal, for example: /goal Keep my inbox at zero this week",
      );
      return undefined;
    }
    try {
      const id = input.conversationId || (await input.ensureConversation());
      const start = await useCollaborationStore
        .getState()
        .setGoal(id, { objective: rest, successCriteria: [] });
      input.clearDraft();
      send(start, id);
    } catch (error) {
      input.reportError(error instanceof Error ? error.message : String(error));
    }
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
