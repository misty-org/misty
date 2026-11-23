import { useEffect } from "react";
import { useAgentFoldersStore } from "./agent_folders_store";

export function useAgentFolderSync(accountId: string): void {
  useEffect(() => {
    void useAgentFoldersStore.getState().load(accountId);
  }, [accountId]);
}
