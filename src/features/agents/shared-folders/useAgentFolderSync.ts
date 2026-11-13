import { useEffect } from "react";
import { useAgentFoldersStore } from "./agentFoldersStore";

/** Loads this device's agent folders. Folders, filing and read state live on this device. */
export function useAgentFolderSync(accountId: string): void {
  useEffect(() => {
    void useAgentFoldersStore.getState().load(accountId);
  }, [accountId]);
}
