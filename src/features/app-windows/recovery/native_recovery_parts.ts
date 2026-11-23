import { useWorkspaceStore } from "../tabs/use_workspace_store";
import { partialWorkspaceStore } from "../tabs/workspace_store_persistence";
import { browserWorkspaceStoreVersion } from "./workspace_recovery_storage";

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
