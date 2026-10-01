import type { SpaceInvitation } from "@/api/spaces/dto/interfaces/types";
import type { ActivityItem, ActivityKind, ActivityTarget } from "./types";

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
    sourceLabel: invitation.space_name,
    spaceId: invitation.space_id,
    lifecycle: "request",
    kind: "invitation",
    title: `${inviter} invited you to ${invitation.space_name}`,
    body: "Review the invitation in Misty.",
    createdAt: validIsoDate(invitation.created_at),
    attention: true,
    target: { kind: "space", spaceId: invitation.space_id },
  };
}

export function activityKindNeedsAttention(kind: ActivityKind): boolean {
  return [
    "mention",
    "reply",
    "invitation",
    "approval",
    "reminder",
    "failure",
    "completion",
  ].includes(kind);
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
  section: "journal" | "planner" | "social" | "chat" | "library",
): number {
  return items.filter((item) => {
    if (item.readAt || !("spaceId" in item.target) || item.target.spaceId !== spaceId) return false;
    if (section === "social" || section === "chat") return item.target.kind === "space-chat";
    if (section === "planner") return item.target.kind === "space-task";
    return false;
  }).length;
}

export function unreadActivityCountForTool(
  items: ActivityItem[],
  tool: "files" | "agents" | "marketplace",
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
  if (target.kind === "space-chat") return parts[2] === "social" || parts[2] === "chat";
  if (target.kind === "space-task") return parts[2] === "planner";
  return parts[2] === "invitation";
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
