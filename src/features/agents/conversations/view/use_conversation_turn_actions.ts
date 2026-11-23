import { useRef, useState } from "react";
import { useStableCallback } from "@/shared/hooks/use_stable_callback";
import type { GlobalAiConversation } from "../state/conversation_types";
import { useMistyStore } from "../state/use_misty_store";
import { resumePrompt, withLedgerRows, type LedgerRow } from "../../checkpoints/ledger";
import {
  removedRunIds,
  restoreTurnFiles,
  rewindFiles,
  type RewindFiles,
} from "../../checkpoints/turn_files";
import type { RewindChoice } from "./RewindFilesDialog";

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
  const rewindTo = async (fromMessageId: string): Promise<boolean> => {
    const conversationId = conversation?.id;
    const messages = conversation?.messages ?? [];
    const index = messages.findIndex((message) => message.id === fromMessageId);
    if (!conversationId || index < 0) return false;
    const store = useMistyStore.getState();
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
  const retryPrompt = useStableCallback((prompt: string, fromMessageId?: string) => {
    void (async () => {
      if (fromMessageId && conversation?.id && !(await rewindTo(fromMessageId))) return;
      send(prompt, false);
    })();
  });
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
