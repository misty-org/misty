import { useEffect } from "react";
import { observeAccountChanges } from "@/api/account-events";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { useAgentFoldersStore } from "./agentFoldersStore";

/**
 * Loads this device's agent folders and follows the names the server generates
 * after a conversation starts. Folders, filing and read state live on this device
 * (docs/agents/chats-local.md), so only titles arrive from the account.
 * The first run only needs folders; the Agents page already loads conversations.
 */
export function useAgentFolderSync(accountId: string): void {
  useEffect(() => {
    if (!accountId) {
      void useAgentFoldersStore.getState().load("");
      return;
    }
    let initial = true;
    return observeAccountChanges(accountId, ["conversation-titles"], () => {
      const reloadConversations = !initial;
      initial = false;
      return Promise.all([
        useAgentFoldersStore.getState().load(accountId),
        reloadConversations ? useMistyStore.getState().loadConversations() : undefined,
      ]);
    });
  }, [accountId]);
}
