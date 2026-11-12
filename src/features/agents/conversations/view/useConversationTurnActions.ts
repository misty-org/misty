import { useRef, useState } from "react";
import { useStableCallback } from "@/shared/hooks/useStableCallback";
import type { GlobalAiConversation } from "../state/conversationTypes";
import { useMistyStore } from "../state/useMistyStore";
import { resumePrompt, withLedgerRows, type LedgerRow } from "../../checkpoints/ledger";
import {
  removedRunIds,
  restoreTurnFiles,
  rewindFiles,
  type RewindFiles,
} from "../../checkpoints/turnFiles";
import type { RewindChoice } from "./RewindFilesDialog";

/**
 * What the transcript's answers and prompts can do to the conversation: send a prompt again,
 * carry on from an answer's ledger, or edit that ledger. `send` sends a prompt; `resume`
 * continues on the screen the earlier run held. Going back past turns that changed files asks
 * first whether to put those files back (`filesAsk`, shown by RewindFilesDialog).
 */
export function useConversationTurnActions(
  conversation: GlobalAiConversation | undefined,
  send: (prompt: string, resume: boolean) => void,
  reportError: (message: string) => void = () => undefined,
) {
  const [filesAsk, setFilesAsk] = useState<RewindFiles | null>(null);
  const answer = useRef<((choice: RewindChoice) => void) | null>(null);
  const chooseFiles = useStableCallback((choice: RewindChoice) => {
    const resolve = answer.current;
    answer.current = null;
    setFilesAsk(null);
    resolve?.(choice);
  });
  // Cuts the chat back to `fromMessageId`, and puts back the files the removed turns changed
  // if the person agrees. False when they called it off, so nothing is sent.
  const rewindTo = async (fromMessageId: string): Promise<boolean> => {
    const conversationId = conversation?.id;
    const messages = conversation?.messages ?? [];
    const index = messages.findIndex((message) => message.id === fromMessageId);
    if (!conversationId || index < 0) return false;
    const store = useMistyStore.getState();
    // A run still going keeps its files; the cut itself waits for it too.
    if (store.working) {
      store.rewindConversation(conversationId, fromMessageId);
      return true;
    }
    const runIds = removedRunIds(messages, index);
    const plan = await rewindFiles(runIds);
    if (plan?.folders.length) {
      const choice = await new Promise<RewindChoice>((resolve) => {
        answer.current?.({ kind: "cancel" });
        answer.current = resolve;
        setFilesAsk(plan);
      });
      if (choice.kind === "cancel") return false;
      if (choice.kind === "restore") {
        try {
          const { failed } = await restoreTurnFiles(runIds, choice.files);
          if (failed.length)
            reportError(
              `${failed.length === 1 ? "A file" : `${failed.length} files`} couldn't be put back: ${failed.join(", ")}`,
            );
        } catch (error) {
          reportError(error instanceof Error ? error.message : String(error));
          return false;
        }
      }
    }
    useMistyStore.getState().rewindConversation(conversationId, fromMessageId);
    return true;
  };
  // Stable, so the memoized transcript skips re-rendering while the person types.
  // Sending again starts from the prompt's own place: it and what followed are replaced,
  // never repeated beneath the old attempt.
  const retryPrompt = useStableCallback((prompt: string, fromMessageId?: string) => {
    void (async () => {
      if (fromMessageId && conversation?.id && !(await rewindTo(fromMessageId))) return;
      send(prompt, false);
    })();
  });
  // Carries on from an answer's ledger: what came after that answer is replaced, so the run
  // continues from that point with its finished parts kept.
  const resumeLedger = useStableCallback(
    (messageId: string, rows: LedgerRow[], only?: string[]) => {
      const messages = conversation?.messages ?? [];
      const index = messages.findIndex((message) => message.id === messageId);
      const conversationId = conversation?.id;
      if (index < 0 || !conversationId) return;
      const answer = messages[index]!;
      const next = messages[index + 1];
      void (async () => {
        if (next && !(await rewindTo(next.id))) return;
        useMistyStore
          .getState()
          .setMessageLedger(conversationId, messageId, withLedgerRows(answer.content, rows));
        send(resumePrompt(rows, only), true);
      })();
    },
  );
  const changeLedger = useStableCallback((messageId: string, rows: LedgerRow[]) => {
    const answer = conversation?.messages.find((message) => message.id === messageId);
    if (answer && conversation?.id)
      useMistyStore
        .getState()
        .setMessageLedger(conversation.id, messageId, withLedgerRows(answer.content, rows));
  });
  return { retryPrompt, resumeLedger, changeLedger, filesAsk, chooseFiles };
}
