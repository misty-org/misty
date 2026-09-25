import type { NativeSyncView } from "./native";

export interface SyncBadgeStatus {
  tone: "green" | "red" | "neutral";
  title: string;
  detail: string;
  local: string;
  websiteData: string;
  spinning: boolean;
}

export function syncBadgeStatus(input: {
  accountId: string;
  recovery: { accountId: string | null; ready: boolean; issue: string | null };
  session: NativeSyncView | null;
  issue: string | null;
  connecting: boolean;
}): SyncBadgeStatus {
  const { accountId, recovery, connecting } = input;
  const session = input.session?.account_id === accountId ? input.session : null;
  const localIssue = recovery.accountId === accountId ? recovery.issue : null;
  const saved = recovery.accountId === accountId && recovery.ready && !localIssue;
  const websiteData =
    session?.supports_cookie_handoff === false
      ? "Not supported on this device"
      : session?.browser_profile_issue
        ? "Needs attention"
        : session?.browser_profile_ready
          ? "Ready"
          : "Waiting for sync";
  const base = {
    local: saved ? "Saved on this device" : "Not saved yet",
    websiteData,
    spinning: false,
  };
  if (localIssue)
    return {
      ...base,
      tone: "red",
      title: "Local saving needs attention",
      detail: "You can keep browsing while we retry. New changes may be lost if you close Misty.",
    };
  const issue = input.issue ?? session?.status.issue ?? session?.browser_profile_issue;
  if (issue) return { ...base, tone: "red", title: "Sync needs attention", detail: issue };
  if (!saved)
    return {
      ...base,
      tone: "neutral",
      title: "Restoring workspace",
      detail: "Restoring local saving in the background.",
      spinning: true,
    };
  if (!session)
    return {
      ...base,
      tone: "neutral",
      title: connecting ? "Connecting" : "Sync is not connected",
      detail: connecting
        ? "Connecting in the background."
        : "Open Settings to set up or unlock device sync.",
      spinning: connecting,
    };
  if (session.status.phase === "offline")
    return {
      ...base,
      tone: "red",
      title: "Sync is offline",
      detail:
        "Your workspace is saved on this device. Sync will retry automatically when a connection is available.",
    };
  if (session.status.phase === "attention" || session.status.phase === "stopped")
    return {
      ...base,
      tone: "red",
      title: "Sync needs attention",
      detail: "Sync has stopped. We’ll try to reconnect automatically.",
    };
  if (session.status.phase === "connecting")
    return {
      ...base,
      tone: "neutral",
      title: "Connecting",
      detail: "Your workspace is saved on this device. Connecting to device sync…",
      spinning: true,
    };
  if (session.full_sync === false)
    return {
      ...base,
      websiteData: "Kept on this device",
      tone: "green",
      title: "Independent workspace",
      detail: "Full sync is off. This device stays connected; its tabs and website data stay here.",
    };
  const pending = session.status.pending_changes;
  const receiving =
    session.status.phase === "catching_up" ||
    session.status.applied_sequence < session.status.head_sequence;
  if (pending || receiving)
    return {
      ...base,
      tone: "green",
      title: "Syncing",
      spinning: true,
      detail: pending
        ? `${pending} ${pending === 1 ? "change" : "changes"} waiting to sync.`
        : "Receiving your workspace changes.",
    };
  if (session.supports_cookie_handoff !== false && session.browser_profile_ready === false)
    return {
      ...base,
      tone: "green",
      title: "Syncing website data",
      detail: "Your workspace is up to date. Website sign-ins and storage are still preparing.",
      spinning: true,
    };
  return {
    ...base,
    tone: "green",
    title: "Up to date",
    detail: "Your workspace is saved on this device and synced across devices.",
  };
}
