import { useEffect } from "react";
import { observeAccountChanges } from "@/api/accountEvents";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { useAgentFoldersStore } from "./agentFoldersStore";

/**
 * Loads the account's agent folders and follows folder, filing, read and title
 * changes, including names generated after a conversation starts. The first
 * run only needs folders; the Agents page already loads conversations on its own.
 */
export function useAgentFolderSync(accountId: string): void {
  useEffect(() => {
    if (!accountId) {
      void useAgentFoldersStore.getState().load("");
      return;
    }
    let initial = true;
    return observeAccountChanges(
      accountId,
      ["agent-folders", "conversation-reads", "conversation-titles"],
      () => {
        const reloadConversations = !initial;
        initial = false;
        return Promise.all([
          useAgentFoldersStore.getState().load(accountId),
          reloadConversations ? useMistyStore.getState().loadConversations() : undefined,
        ]);
      },
    );
  }, [accountId]);
}
