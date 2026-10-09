import type { SpaceOverviewItem } from "./useSpaceOverview";
export interface SpaceSuggestion {
  item: SpaceOverviewItem;
  reason: string;
  order: number;
  route: string;
}
/** The signed-in member's open tasks due by the end of today, earliest first. */
export function spaceSuggestions(
  items: SpaceOverviewItem[],
  accountId: string,
  now = new Date(),
): SpaceSuggestion[] {
  const endToday = new Date(now);
  endToday.setHours(23, 59, 59, 999);
  const result: SpaceSuggestion[] = [];
  for (const item of items) {
    const due = Date.parse(item.dueAt ?? "");
    if (
      item.kind === "task" &&
      item.assigneeUserId === accountId &&
      !item.completed &&
      Number.isFinite(due) &&
      due <= endToday.getTime()
    )
      result.push({
        item,
        reason: due < now.getTime() ? "Overdue" : "Due today",
        order: due,
        route: item.route,
      });
  }
  return result.sort((a, b) => a.order - b.order);
}
