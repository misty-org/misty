import type { ActivityItem } from "./types";

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
