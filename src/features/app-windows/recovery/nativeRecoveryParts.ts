import { useWorkspaceStore } from "../tabs/useWorkspaceStore";
import { partialWorkspaceStore } from "../tabs/workspaceStorePersistence";
import { browserWorkspaceStoreVersion } from "./workspaceRecoveryStorage";

/** A workspace kept in memory while the account's saved one cannot be read. */
export type TemporaryWorkspace = {
  accountId: string;
  baseline: ReturnType<typeof partialWorkspaceStore>;
  unregister: () => void;
};

export const captureWorkspace = () =>
  JSON.stringify({
    version: browserWorkspaceStoreVersion,
    state: partialWorkspaceStore(useWorkspaceStore.getState()),
  });

export function failure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
