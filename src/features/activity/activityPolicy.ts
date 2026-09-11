import type { ActivityItem, ActivityCategory } from "./types";

export const activityCategories: Record<ActivityCategory, string> = {
  conversations: "Conversations",
  invitations: "Invitations",
  reminders: "Reminders",
  requests: "Requests and blocked work",
  completions: "Background completions",
};

export function isDiagnosticActivity(item: ActivityItem): boolean {
  if (item.visibility) return item.visibility === "diagnostic";
  if (item.source !== "device" || !item.sourceId.startsWith("system-error:")) return false;
  // Old Inbox refresh reports used the same diagnostic reporter as user actions.
  // Keep explicit action scopes; isolate polling reports without guessing from message text.
  if (/^system-error:inbox:(?!reply:|summary:|link:|compose:|attachments:)/.test(item.sourceId))
    return true;
  return /^system-error:(?:app:|spaces:(?:load|realtime):|files:connected-devices:|files-sources:)/.test(
    item.sourceId,
  );
}

export function isActivityRequest(item: ActivityItem): boolean {
  // Legacy error reports contain no durable request/operation lifecycle. They are
  // readable updates, not approvals or blocked operations that must be resolved.
  if (item.source === "device" && item.sourceId.startsWith("system-error:") && !item.lifecycle)
    return false;
  return (
    item.lifecycle === "request" ||
    ["approval", "invitation", "failure"].includes(item.kind) ||
    item.source === "interventions"
  );
}

export function isPendingRequest(item: ActivityItem): boolean {
  return isActivityRequest(item) && !item.resolvedAt;
}

export function activityCategory(item: ActivityItem): ActivityCategory | null {
  if (item.kind === "invitation") return "invitations";
  if (isActivityRequest(item) || item.kind === "failure") return "requests";
  if (["mention", "reply"].includes(item.kind)) return "conversations";
  if (item.kind === "reminder") return "reminders";
  if (item.kind === "completion") return "completions";
  return null;
}

export function activityMuteKeys(item: ActivityItem): string[] {
  const spaceId = item.spaceId ?? ("spaceId" in item.target ? item.target.spaceId : undefined);
  return [spaceId ? `space:${spaceId}` : "", item.appId ? `app:${item.appId}` : ""].filter(Boolean);
}

export function isActivityMuted(item: ActivityItem, muted: string[] = []): boolean {
  return activityMuteKeys(item).some((key) => muted.includes(key));
}

export function needsActivityAttention(item: ActivityItem, muted: string[] = []): boolean {
  if (isDiagnosticActivity(item) || item.resolvedAt) return false;
  if (isPendingRequest(item)) return true;
  return !item.readAt && !isActivityMuted(item, muted) && activityCategory(item) !== null;
}

export function shouldNotifyActivity(item: ActivityItem): boolean {
  return needsActivityAttention(item) && activityCategory(item) !== null;
}

/** Copy edits and repeated polling are not new events. */
export function activityTransition(item: ActivityItem): string {
  return `${item.id}:${item.resolvedAt ? "resolved" : (item.revision ?? item.status ?? item.kind)}`;
}

export function compareAttention(left: ActivityItem, right: ActivityItem): number {
  return (
    Number(isPendingRequest(right)) - Number(isPendingRequest(left)) ||
    Date.parse(right.updatedAt ?? right.createdAt) - Date.parse(left.updatedAt ?? left.createdAt) ||
    right.id.localeCompare(left.id)
  );
}
