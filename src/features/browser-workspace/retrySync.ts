import {
  isApiSessionTransitioning,
  readApiAuthToken,
  readApiSessionGeneration,
} from "@/api/client/session";
import { resolveApiBase } from "@/api/deployment/api";
import { useSettingsProfiles } from "@/features/settings/sync";
import { useWorkspaceRecoveryState } from "@/features/workspace/nativeWorkspaceRecovery";
import { retryWorkspaceRecovery } from "@/features/workspace/useWorkspaceRecoveryRetry";
import { lockNativeSync, unlockNativeSync, vaultAvailability } from "./native";
import { useBrowserSyncStore } from "./store";
import type { SyncActionKind } from "./syncStatus";
export type RetrySyncResult = "complete" | "credentials" | "setup" | "sign-in" | "stale";
const attempts = new Map<string, Promise<RetrySyncResult>>();
/** Every user-initiated sync recovery enters here, including settings-only retries. */
export function retrySync(
  accountId: string,
  action: SyncActionKind = "retry",
  settingsOnly = false,
): Promise<RetrySyncResult> {
  const generation = readApiSessionGeneration();
  const key = `${generation}:${accountId}:${settingsOnly ? "settings" : "workspace"}`;
  const pending = attempts.get(key);
  if (pending) return pending;
  const valid = () => !isApiSessionTransitioning() && generation === readApiSessionGeneration();
  const attempt = (async (): Promise<RetrySyncResult> => {
    if (!valid()) return "stale";
    if (!accountId || action === "sign-in") return "sign-in";
    if (action === "setup") return "setup";
    const state = useBrowserSyncStore.getState();
    const session = state.session?.account_id === accountId ? state.session : null;
    if (
      !settingsOnly &&
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
    if (!settingsOnly && recovery.accountId === accountId && (!recovery.ready || recovery.issue))
      await retryWorkspaceRecovery(accountId, valid);
    if (!valid()) return "stale";
    const prefs = useSettingsProfiles.getState();
    if (prefs.accountId === accountId && prefs.ready) {
      try {
        await prefs.refresh();
      } catch (error) {
        // The preferences store retains its error for the shared status selector.
        // An account-settings outage must not prevent native workspace recovery.
        if (settingsOnly) throw error;
      }
    }
    if (!valid()) return "stale";
    if (settingsOnly) return "complete";
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
