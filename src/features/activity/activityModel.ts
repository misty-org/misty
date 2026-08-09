import type { SpaceInboxItem, SpaceInvitation } from "@/models/interfaces/features/spaces/types";
import type { ActivityItem, ActivityKind, ActivityTarget } from "./types";

const failureWords = /\b(fail(?:ed|ure)?|error|blocked|needs attention)\b/i;

export function activityItemsFromSpaces(
  accountId: string,
  inbox: { unreads: SpaceInboxItem[]; mentions: SpaceInboxItem[] },
  invitations: SpaceInvitation[],
): ActivityItem[] {
  if (!accountId) return [];
  const items = new Map<string, ActivityItem>();
  for (const item of [...inbox.unreads, ...inbox.mentions]) {
    const mapped = activityItemFromSpaceInbox(accountId, item);
    items.set(mapped.id, mapped);
  }
  for (const invitation of invitations) {
    const mapped = activityItemFromInvitation(accountId, invitation);
    items.set(mapped.id, mapped);
  }
  return [...items.values()].sort(compareActivityNewestFirst);
}

export function activityItemFromSpaceInbox(accountId: string, item: SpaceInboxItem): ActivityItem {
  const actor = stringPayload(item.payload, "sender_name") || "Someone";
  const preview = stringPayload(item.payload, "preview");
  const kind = spaceInboxActivityKind(item);
  const attention = activityKindNeedsAttention(kind);
  return {
    id: `spaces:${item.id}`,
    accountId,
    source: "spaces",
    sourceId: String(item.id),
    kind,
    title: activityTitle(kind, actor, item.space_name),
    body: preview,
    createdAt: validIsoDate(item.created_at),
    ...(item.seen_at ? { readAt: validIsoDate(item.seen_at) } : {}),
    attention,
    target: activityTarget(item, kind),
  };
}

export function activityItemFromInvitation(
  accountId: string,
  invitation: SpaceInvitation,
): ActivityItem {
  const inviter = invitation.inviter_name?.trim() || "Someone";
  return {
    id: `invitation:${invitation.id}`,
    accountId,
    source: "invitation",
    sourceId: invitation.id,
    kind: "invitation",
    title: `${inviter} invited you to ${invitation.space_name}`,
    body: "Review the invitation in Misty.",
    createdAt: validIsoDate(invitation.created_at),
    attention: true,
    target: { kind: "space", spaceId: invitation.space_id },
  };
}

export function activityKindNeedsAttention(kind: ActivityKind): boolean {
  return ["mention", "reply", "invitation", "approval", "reminder", "failure"].includes(kind);
}

export function compareActivityNewestFirst(left: ActivityItem, right: ActivityItem): number {
  return (
    Date.parse(right.createdAt) - Date.parse(left.createdAt) || right.id.localeCompare(left.id)
  );
}

export function formatActivityBadge(count: number): string {
  return count > 99 ? "99+" : String(Math.max(0, count));
}

export function unreadActivityCountForSpace(items: ActivityItem[], spaceId: string): number {
  return items.filter((item) => {
    if (item.readAt) return false;
    return "spaceId" in item.target && item.target.spaceId === spaceId;
  }).length;
}

export function unreadActivityCountForSpaceSection(
  items: ActivityItem[],
  spaceId: string,
  section: "journal" | "planner" | "chat" | "library",
): number {
  return items.filter((item) => {
    if (item.readAt || !("spaceId" in item.target) || item.target.spaceId !== spaceId) return false;
    if (section === "chat") return item.target.kind === "space-chat";
    if (section === "planner") return item.target.kind === "space-task";
    return false;
  }).length;
}

export function unreadActivityCountForTool(
  items: ActivityItem[],
  tool: "files" | "agents" | "extensions" | "transfers",
): number {
  return items.filter(
    (item) => !item.readAt && item.target.kind === "workspace-tool" && item.target.tool === tool,
  ).length;
}

export function activityTargetMatchesLocation(target: ActivityTarget, pathname: string): boolean {
  const parts = pathname.split("/").filter(Boolean);
  if (target.kind === "workspace-tool") {
    if (target.tool === "files") return parts[0] === "files";
    return parts[0] === target.tool;
  }
  if (!("spaceId" in target) || parts[0] !== "spaces") return false;
  const routeSpaceId = safeDecode(parts[1] ?? "");
  if (routeSpaceId !== target.spaceId) return false;
  if (target.kind === "space-chat") return parts[2] === "chat";
  if (target.kind === "space-task") return parts[2] === "planner";
  return parts[2] === "invitation";
}

function spaceInboxActivityKind(item: SpaceInboxItem): ActivityKind {
  if (item.kind === "mention") return "mention";
  if (item.kind === "approval") return "approval";
  if (item.kind === "agent") return payloadNeedsApproval(item.payload) ? "approval" : "agent";
  if (item.kind === "workflow") {
    return payloadFailed(item.payload)
      ? "failure"
      : payloadNeedsApproval(item.payload)
        ? "approval"
        : "workflow";
  }
  if (payloadIsReply(item.payload)) return "reply";
  if (payloadFailed(item.payload)) return "failure";
  return "message";
}

function activityTarget(item: SpaceInboxItem, kind: ActivityKind): ActivityTarget {
  const taskId = stringPayload(item.payload, "task_id");
  if (taskId) return { kind: "space-task", spaceId: item.space_id, taskId };
  if (kind === "approval" && item.kind === "agent") {
    return { kind: "workspace-tool", tool: "agents" };
  }
  return {
    kind: "space-chat",
    spaceId: item.space_id,
    ...(item.message_id ? { messageId: item.message_id } : {}),
  };
}

function payloadIsReply(payload: Record<string, unknown>): boolean {
  return Boolean(
    payload.reply_to_message_id ||
    payload.reply_to_me ||
    payload.is_reply ||
    stringPayload(payload, "kind").toLowerCase() === "reply",
  );
}

function payloadNeedsApproval(payload: Record<string, unknown>): boolean {
  return Boolean(
    payload.requires_approval || payload.approval_required || payload.awaiting_approval,
  );
}

function payloadFailed(payload: Record<string, unknown>): boolean {
  return ["status", "level", "message", "preview"]
    .map((key) => stringPayload(payload, key))
    .some((value) => failureWords.test(value));
}

function activityTitle(kind: ActivityKind, actor: string, spaceName: string): string {
  switch (kind) {
    case "mention":
      return `${actor} mentioned you in ${spaceName}`;
    case "reply":
      return `${actor} replied to you in ${spaceName}`;
    case "approval":
      return `${spaceName} needs your approval`;
    case "failure":
      return `${spaceName} needs attention`;
    case "agent":
      return `Agent activity in ${spaceName}`;
    case "workflow":
      return `Workflow activity in ${spaceName}`;
    default:
      return `${actor} posted in ${spaceName}`;
  }
}

function stringPayload(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value.trim() : "";
}

function validIsoDate(value: string | undefined): string {
  const timestamp = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : new Date().toISOString();
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
