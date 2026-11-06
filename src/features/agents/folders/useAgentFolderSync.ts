import { useEffect } from "react";
import { observeAccountChanges } from "@/api/account-events";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { useAgentFoldersStore } from "./agentFoldersStore";

/**
 * Loads the agent folders and follows changes from the person's other signed-in sessions:
 * the names the server generates after a conversation starts, and folders and filing.
 * The first run only needs folders; the Agents page already loads conversations.
 */
export function useAgentFolderSync(accountId: string): void {
  useEffect(() => {
    if (!accountId) {
      void useAgentFoldersStore.getState().load("");
      return;
    }
    let initial = true;
    return observeAccountChanges(accountId, ["conversation-titles", "agent-folders"], () => {
      const reloadConversations = !initial;
      initial = false;
      return Promise.all([
        useAgentFoldersStore.getState().load(accountId),
        reloadConversations ? useMistyStore.getState().loadConversations() : undefined,
      ]);
    });
  }, [accountId]);
}
