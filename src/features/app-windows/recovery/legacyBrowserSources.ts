import { deploymentStorageKey } from "@/api/deployment/api";
import { legacyWorkspaceCandidate, workspaceStoreStorageKey } from "./workspaceRecoveryPlatform";
import { workspaceRecoveryKey } from "./workspaceRecoveryStorage";

/**
 * Workspaces from before native recovery, still in browser storage. Only the first profile's
 * window takes them over, and only the account that owned them. `sources` are the exact originals
 * to archive and later remove; `newest` is the one to open.
 */
export function legacyBrowserSources(accountId: string, takesOver: boolean) {
  const key = deploymentStorageKey(`misty:workspace-account:${accountId}`);
  const sources: [string, string][] = [];
  const account = takesOver ? localStorage.getItem(key) : null;
  const backup = takesOver ? localStorage.getItem(workspaceRecoveryKey(key)) : null;
  if (account !== null) sources.push([key, account]);
  if (backup !== null) sources.push([workspaceRecoveryKey(key), backup]);
  const candidate = takesOver ? legacyWorkspaceCandidate() : undefined;
  const global = candidate?.owner === accountId ? candidate : undefined;
  const liveGlobal = global && localStorage.getItem(workspaceStoreStorageKey) === global.raw;
  if (liveGlobal) {
    sources.push([workspaceStoreStorageKey, global.raw]);
    if (global.backup !== null)
      sources.push([workspaceRecoveryKey(workspaceStoreStorageKey), global.backup]);
  }
  return { sources, newest: liveGlobal ? global.raw : account };
}
