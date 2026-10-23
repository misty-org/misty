import {
  isApiSessionTransitioning,
  readApiAuthToken,
  readApiSessionGeneration,
} from "@/api/client/session";
import { resolveApiBase } from "@/api/deployment/api";
import { useWorkspaceRecoveryState } from "@/features/workspace/nativeWorkspaceRecovery";
import { retryWorkspaceRecovery } from "@/features/workspace/useWorkspaceRecoveryRetry";
import { flushNativeSync, lockNativeSync, unlockNativeSync, vaultAvailability } from "./native";
import { useBrowserSyncStore } from "./store";
import type { SyncActionKind } from "./syncStatus";
export type RetrySyncResult = "complete" | "credentials" | "setup" | "sign-in" | "stale" | "sent";
const attempts = new Map<string, Promise<RetrySyncResult>>();
/** Every user-initiated sync recovery enters here. `webOnly` skips the native workspace. */
export function retrySync(
  accountId: string,
  action: SyncActionKind = "retry",
  webOnly = false,
): Promise<RetrySyncResult> {
  const generation = readApiSessionGeneration();
  const key = `${generation}:${accountId}:${webOnly ? "web" : "workspace"}`;
  const pending = attempts.get(key);
  if (pending) return pending;
  const valid = () => !isApiSessionTransitioning() && generation === readApiSessionGeneration();
  const attempt = (async (): Promise<RetrySyncResult> => {
    if (!valid()) return "stale";
    if (!accountId || action === "sign-in") return "sign-in";
    if (action === "setup") return "setup";
    const state = useBrowserSyncStore.getState();
    const session = state.session?.account_id === accountId ? state.session : null;
    if (action === "sync-now" && session && !webOnly) {
      await flushNativeSync(session.session_id);
      return "sent";
    }
    if (
      !webOnly &&
      (action === "reenroll" ||
        state.reenroll === accountId ||
        (state.issue ?? session?.status.issue) === "sync_device_forbidden")
    ) {
      if (session) await lockNativeSync(session.session_id, true);
      if (!valid()) return "stale";
      useBrowserSyncStore.setState({ session: null, issue: null, reenroll: accountId });
      return "credentials";
    }
    const recovery = useWorkspaceRecoveryState.getState();
    if (!webOnly && recovery.accountId === accountId && (!recovery.ready || recovery.issue))
      await retryWorkspaceRecovery(accountId, valid);
    if (!valid()) return "stale";
    if (!valid()) return "stale";
    if (webOnly) return "complete";
    await readApiAuthToken();
    if (!valid()) return "stale";
    const account = { apiBase: await resolveApiBase(), accountId };
    if (!valid()) return "stale";
    try {
      const opened = await unlockNativeSync(account, null, null, false);
      if (!valid()) return "stale";
      useBrowserSyncStore.setState({ session: opened, issue: null, reenroll: null, locked: null });
      return "complete";
    } catch (error) {
      if (!valid()) return "stale";
      const available = await vaultAvailability(account);
      if (!valid()) return "stale";
      if (!available.local) {
        useBrowserSyncStore.setState({ session: null, issue: null });
        return available.remote === false ? "setup" : "credentials";
      }
      throw error;
    }
  })().finally(() => {
    if (attempts.get(key) === attempt) attempts.delete(key);
  });
  attempts.set(key, attempt);
  return attempt;
}
