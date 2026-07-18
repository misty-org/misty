import type { NativeSyncView } from "./native";
import { currentDeviceId } from "./websiteData";

export type SyncActionKind = "retry" | "unlock" | "reenroll" | "setup" | "sign-in";
export interface SyncStatus {
  /** Semantic only: all states render in the monochrome palette. */
  tone: "healthy" | "attention" | "neutral";
  title: string;
  detail: string;
  action: { kind: SyncActionKind; label: string } | null;
}
const actions: Record<SyncActionKind, NonNullable<SyncStatus["action"]>> = {
  retry: { kind: "retry", label: "Retry sync" },
  unlock: { kind: "unlock", label: "Unlock sync" },
  reenroll: { kind: "reenroll", label: "Reconnect device" },
  setup: { kind: "setup", label: "Set up sync" },
  "sign-in": { kind: "sign-in", label: "Sign in" },
};
const attention = (title: string, detail: string, kind: SyncActionKind = "retry"): SyncStatus => ({
  tone: "attention",
  title,
  detail,
  action: actions[kind],
});
const neutral = (title: string, detail: string): SyncStatus => ({
  tone: "neutral",
  title,
  detail,
  action: null,
});
export const syncIssues: Record<string, SyncStatus> = {
  sign_in_required: attention(
    "Sign in to resume sync",
    "Your Misty session has expired. Sign in again to reconnect sync.",
    "sign-in",
  ),
  sync_device_forbidden: attention(
    "This device needs to reconnect",
    "Its sync access was removed. Enter your sync password and secret to register it again.",
    "reenroll",
  ),
  vault_identity_failed: attention(
    "Verify this device",
    "Misty could not verify this device’s sync identity. Existing local data is preserved.",
  ),
  replay_conflict: attention(
    "Sync needs to reconnect",
    "Misty could not safely apply changes in order. Existing local data is preserved.",
  ),
  checkpoint_or_key_recovery_required: attention(
    "Sync needs recovery",
    "Misty needs to restore its sync connection or unlock the vault again. Existing local data is preserved.",
  ),
  local_storage_unavailable: attention(
    "Local saving needs attention",
    "Misty cannot write sync data. Check available disk space and keep Misty open until saved.",
  ),
  sync_protocol_failed: attention(
    "Sync could not complete",
    "Misty could not finish exchanging changes with the server.",
  ),
};
export function syncIssueStatus(issue: string): SyncStatus {
  return (
    syncIssues[issue] ??
    attention(
      "Sync needs attention",
      "Misty could not complete sync. Retry to reconnect; your existing data is preserved.",
    )
  );
}
export interface SyncStatusInput {
  accountId: string;
  session?: NativeSyncView | null;
  issue?: string | null;
  operationError?: string | null;
  connecting?: boolean;
  locked?: boolean;
  reenroll?: boolean;
  desktop?: boolean;
  online?: boolean;
  recovery?: { accountId: string | null; ready: boolean; issue: string | null };
  vault?: { local: boolean; remote: boolean | null } | null;
  preferences?: {
    accountId: string;
    ready: boolean;
    syncing: boolean;
    error: string | null;
    pending: number;
    synced?: boolean;
  };
  scope?: "all" | "settings";
}
/** One ordering and one set of copy for settings, popup and account preferences. */
export function selectSyncStatus(input: SyncStatusInput): SyncStatus {
  if (!input.accountId)
    return attention(
      "Sign in to sync",
      "Sign in to Misty to sync this workspace and your settings.",
      "sign-in",
    );
  const prefs = input.preferences?.accountId === input.accountId ? input.preferences : null;
  const settingsOnly = input.scope === "settings" || input.desktop === false;
  const recovery =
    !settingsOnly && input.recovery?.accountId === input.accountId ? input.recovery : null;
  if (recovery?.issue) return syncIssues.local_storage_unavailable;
  if (input.operationError) return attention("Sync needs attention", input.operationError);
  const session = input.session?.account_id === input.accountId ? input.session : null;
  if (!settingsOnly) {
    if (input.reenroll) return syncIssues.sync_device_forbidden;
    const issue = (input.session && !session ? null : input.issue) ?? session?.status.issue;
    if (issue && !input.locked) return syncIssueStatus(issue);
    if (session?.browser_profile_issue)
      return attention(
        "Website sign-ins need attention",
        "Misty could not finish syncing website sign-ins. Your workspace remains available.",
      );
  }
  if (prefs?.error)
    return attention(
      "Settings need attention",
      "Your settings could not be saved to the server. Retry sync to send pending changes.",
    );
  if (!settingsOnly) {
    if (recovery && !recovery.ready)
      return neutral(
        "Restoring workspace",
        "Restoring saved workspace data before syncing changes.",
      );
    if (!session) {
      if (input.connecting)
        return neutral("Connecting", "Connecting to sync. You can keep using Misty.");
      if (input.vault?.remote === false && !input.vault.local)
        return {
          ...neutral(
            "Set up sync",
            "Create a sync vault to share this workspace across your devices.",
          ),
          action: actions.setup,
        };
      return {
        ...neutral(
          "Sync is locked",
          input.vault?.local
            ? "Unlock with the saved device key to resume sync."
            : "Enter your sync password and secret to unlock this workspace.",
        ),
        action: actions.unlock,
      };
    }
    if (session.status.phase === "offline" || input.online === false)
      return attention(
        "Sync is offline",
        "Sync will resume when a connection is available. Changes waiting to reach the server are shown here.",
      );
    if (session.status.phase === "stopped" || session.status.phase === "attention")
      return attention("Sync needs attention", "Sync has stopped. Retry to reconnect this device.");
    if (session.status.phase === "connecting")
      return neutral(
        "Connecting",
        "Connecting to sync. Device availability will update when connected.",
      );
  }
  if (input.online === false)
    return attention(
      "Settings are waiting to sync",
      "Connect to the internet to save pending settings to the server.",
    );
  if (prefs?.pending || prefs?.syncing)
    return neutral(
      "Settings are syncing",
      prefs.pending
        ? `${prefs.pending} ${prefs.pending === 1 ? "change is" : "changes are"} waiting to be saved to the server.`
        : "Saving your settings to the server.",
    );
  if (prefs && (!prefs.ready || prefs.synced === false))
    return neutral("Loading settings", "Reading your account’s settings from the server.");
  if (settingsOnly)
    return prefs?.ready
      ? {
          tone: "healthy",
          title: "Settings are up to date",
          detail: "Your settings are saved to your account and apply across devices.",
          action: null,
        }
      : neutral("Loading settings", "Reading your account’s settings from the server.");
  if (session?.full_sync === false)
    return {
      tone: "neutral",
      title: "Independent workspace",
      detail:
        "This device’s tabs and website sign-ins stay here. Account settings still sync across devices.",
      action: null,
    };
  if (
    session &&
    (session.status.pending_changes ||
      session.status.phase === "catching_up" ||
      session.status.applied_sequence < session.status.head_sequence)
  )
    return neutral(
      "Syncing",
      session.status.pending_changes
        ? `${session.status.pending_changes} workspace changes are waiting to sync.`
        : "Receiving workspace changes from the server.",
    );
  if (session?.supports_cookie_handoff !== false && session?.browser_profile_ready === false)
    return neutral(
      "Syncing website sign-ins",
      "Your workspace is up to date. Cookies and sign-in keys are still preparing.",
    );
  const sites = session?.website_data?.find(
    (d) => d.device_id === (currentDeviceId(session) ?? session.device_id),
  )?.sites;
  if (sites?.some((site) => site.skipped.length))
    return {
      tone: "neutral",
      title: "Some website data cannot sync",
      detail:
        "Your workspace is up to date. Website sign-ins lists the sites and data that could not be copied.",
      action: null,
    };
  return {
    tone: "healthy",
    title: "Up to date",
    detail:
      session?.supports_cookie_handoff === false
        ? "Your workspace and account settings are synced. Website sign-in sync is not supported on this device."
        : "Your workspace and account settings are synced. Website sign-ins are up to date.",
    action: null,
  };
}
