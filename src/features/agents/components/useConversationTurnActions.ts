import { useStableCallback } from "@/shared/hooks/useStableCallback";
import type { GlobalAiConversation } from "@/features/misty/types";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { resumePrompt, withLedgerRows, type LedgerRow } from "../checkpoints/ledger";

/**
 * What the transcript's answers and prompts can do to the conversation: send a prompt again,
 * carry on from an answer's ledger, or edit that ledger. `send` sends a prompt; `resume`
 * continues on the screen the earlier run held.
 */
export function useConversationTurnActions(
  conversation: GlobalAiConversation | undefined,
  send: (prompt: string, resume: boolean) => void,
) {
  // Stable, so the memoized transcript skips re-rendering while the person types.
  // Sending again starts from the prompt's own place: it and what followed are replaced,
  // never repeated beneath the old attempt.
  const retryPrompt = useStableCallback((prompt: string, fromMessageId?: string) => {
    if (fromMessageId && conversation?.id)
      useMistyStore.getState().rewindConversation(conversation.id, fromMessageId);
    send(prompt, false);
  });
  // Carries on from an answer's ledger: what came after that answer is replaced, so the run
  // continues from that point with its finished parts kept (docs/agents/checkpoints.md).
  const resumeLedger = useStableCallback(
    (messageId: string, rows: LedgerRow[], only?: string[]) => {
      const messages = conversation?.messages ?? [];
      const index = messages.findIndex((message) => message.id === messageId);
      if (index < 0 || !conversation?.id) return;
      const store = useMistyStore.getState();
      const answer = messages[index]!;
      store.setMessageLedger(conversation.id, messageId, withLedgerRows(answer.content, rows));
      const next = messages[index + 1];
      if (next) store.rewindConversation(conversation.id, next.id);
      send(resumePrompt(rows, only), true);
    },
  );
  const changeLedger = useStableCallback((messageId: string, rows: LedgerRow[]) => {
    const answer = conversation?.messages.find((message) => message.id === messageId);
    if (answer && conversation?.id)
      useMistyStore
        .getState()
        .setMessageLedger(conversation.id, messageId, withLedgerRows(answer.content, rows));
  });
  return { retryPrompt, resumeLedger, changeLedger };
}
