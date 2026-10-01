import type { ActivityItem } from "@/features/activity/types";
import type { SpaceOverviewItem } from "./useSpaceOverview";
import { spaceItemKeyFromRoute } from "./spaceItemRoute";
export interface SpaceSuggestion {
  item: SpaceOverviewItem;
  reason: string;
  rank: number;
  order: number;
  route: string;
}
export function spaceSuggestions(
  items: SpaceOverviewItem[],
  activity: ActivityItem[],
  accountId: string,
  spaceId: string,
  now = new Date(),
): SpaceSuggestion[] {
  const result = new Map<string, SpaceSuggestion>();
  const endToday = new Date(now);
  endToday.setHours(23, 59, 59, 999);
  for (const item of items) {
    const due = Date.parse(item.dueAt ?? "");
    if (
      item.kind === "task" &&
      item.assigneeUserId === accountId &&
      !item.completed &&
      Number.isFinite(due) &&
      due <= endToday.getTime()
    )
      result.set(item.id, {
        item,
        reason: due < now.getTime() ? "Overdue" : "Due today",
        rank: 0,
        order: due,
        route: item.route,
      });
  }
  for (const signal of activity) {
    if (
      signal.accountId !== accountId ||
      signal.spaceId !== spaceId ||
      signal.resolvedAt ||
      signal.status === "resolved" ||
      signal.status === "completed"
    )
      continue;
    const mention = signal.kind === "mention" && !signal.readAt;
    const request = signal.lifecycle === "request" && signal.attention;
    if (!mention && !request) continue;
    const target = signal.target;
    const key =
      target.kind === "space-chat"
        ? `chat:${target.conversationId || "everyone"}`
        : target.kind === "space-task"
          ? `task:${target.taskId}`
          : target.kind === "route"
            ? spaceItemKeyFromRoute(target.href, spaceId)
            : undefined;
    const item = items.find((item) => item.id === key);
    if (!item || result.has(item.id)) continue;
    const route =
      target.kind === "route"
        ? target.href
        : target.kind === "space-chat" && target.messageId
          ? `${item.route}${item.route.includes("?") ? "&" : "?"}message=${encodeURIComponent(target.messageId)}`
          : item.route;
    result.set(item.id, {
      item,
      reason: mention ? "You were mentioned" : "Response requested",
      rank: mention ? 1 : 2,
      order: -Date.parse(signal.createdAt),
      route,
    });
  }
  return [...result.values()].sort((a, b) => a.rank - b.rank || a.order - b.order);
}
