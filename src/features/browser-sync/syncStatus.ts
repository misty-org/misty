import type { NativeSyncView } from "./native";
import { currentDeviceId } from "./websiteData";

export type SyncActionKind = "retry" | "unlock" | "reenroll" | "setup" | "sign-in" | "sync-now";
export interface SyncStatus {
  /** Semantic only: all states render in the monochrome palette. */
  tone: "healthy" | "attention" | "neutral";
  title: string;
  detail: string;
  /** `short` is the one-word label compact surfaces show. */
  action: { kind: SyncActionKind; label: string; short: string } | null;
}
const actions: Record<SyncActionKind, NonNullable<SyncStatus["action"]>> = {
  retry: { kind: "retry", label: "Retry sync", short: "Retry" },
  unlock: { kind: "unlock", label: "Unlock sync", short: "Unlock" },
  reenroll: { kind: "reenroll", label: "Reconnect device", short: "Reconnect" },
  setup: { kind: "setup", label: "Set up sync", short: "Create" },
  "sign-in": { kind: "sign-in", label: "Sign in", short: "Sign in" },
  "sync-now": { kind: "sync-now", label: "Sync now", short: "Sync" },
};
const setupRequiredIssue = "Set up browser sync before connecting this device.";
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
function syncIssueStatus(issue: string): SyncStatus {
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
  recovery?: {
    accountId: string | null;
    ready: boolean;
    issue: string | null;
    /** Per-item local saving; the popup lists each one. */
    saves?: { pending: string[]; failed: unknown[] };
    notRestored?: unknown[];
  };
  vault?: { local: boolean; remote: boolean | null } | null;
  /** Space names by id, to name a Space whose vault has a problem. */
  spaceNames?: Record<string, string>;
}
/** One ordering and one set of copy for the workspace sync status in settings and the popup. */
export function selectSyncStatus(input: SyncStatusInput): SyncStatus {
  if (!input.accountId)
    return attention("Sign in to sync", "Sign in to Misty to sync this workspace.", "sign-in");
  if (!input.desktop)
    return neutral(
      "Use Misty desktop",
      "Create or unlock an encrypted sync vault in the Misty desktop app.",
    );
  const recovery = input.recovery?.accountId === input.accountId ? input.recovery : null;
  // Local saving reports per item (the popup lists them), never one blanket failure.
  if (recovery?.issue)
    return attention(
      "Saving on this device is paused",
      "Your open tabs stay here. Misty keeps trying and lists what is not saved yet.",
    );
  if (recovery?.saves?.failed.length)
    return attention(
      "Some changes are not saved on this device",
      "They stay open here and are listed below. Misty tries again when they change.",
    );
  const session = input.session?.account_id === input.accountId ? input.session : null;
  if (!session && input.vault?.remote === false && input.vault?.local === false)
    return {
      ...neutral(
        "Set up sync",
        "Create a sync vault to share this workspace across your devices.",
      ),
      action: actions.setup,
    };
  if (!session && input.issue === setupRequiredIssue)
    return neutral(
      "Set up sync",
      "Set up a sync vault to share this workspace across your devices.",
    );
  if (!session && !input.vault?.local && input.operationError)
    return neutral(
      "Set up sync",
      "Set up a sync vault to share this workspace across your devices.",
    );
  if (input.operationError) return attention("Sync needs attention", input.operationError);
  if (input.reenroll) return syncIssues.sync_device_forbidden;
  const issue = (input.session && !session ? null : input.issue) ?? session?.status.issue;
  if (issue && !input.locked) return syncIssueStatus(issue);
  if (session?.browser_profile_issue)
    return attention(
      "Website sign-ins need attention",
      "Misty could not finish syncing website sign-ins. Your workspace remains available.",
    );
  const spaceProblem = session?.space_problems?.[0];
  if (spaceProblem)
    return attention(
      `${input.spaceNames?.[spaceProblem.space_id] ?? "A Space"} needs attention`,
      spaceProblem.issue,
    );
  if (recovery?.notRestored?.length)
    return neutral(
      "Some tabs were not restored",
      "Everything else is back. Their saved copies are kept and listed below.",
    );
  {
    if (recovery && !recovery.ready)
      return neutral(
        "Restoring workspace",
        "Restoring saved workspace data before syncing changes.",
      );
    if (!session) {
      if (input.connecting)
        return neutral("Connecting", "Connecting to sync. You can keep using Misty.");
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
  if (session?.full_sync === false)
    return {
      tone: "neutral",
      title: "Independent workspace",
      detail: "This device’s tabs and website sign-ins stay here.",
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
  // Edits are sent in batches; until a batch is due they wait here.
  if (session?.status.phase === "ready" && session.sync?.pending.length)
    return {
      ...neutral("Syncing", "Recent changes are sent together in a few seconds."),
      action: actions["sync-now"],
    };
  if (recovery?.saves?.pending.length)
    return neutral(
      "Saving on this device",
      "Some changes are kept in an encrypted pending file until local storage accepts them.",
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
        ? "Your workspace is synced. Website sign-in sync is not supported on this device."
        : "Your workspace is synced. Website sign-ins are up to date.",
    action: null,
  };
}
