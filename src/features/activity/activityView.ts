import type { ActivityItem } from "./types";
import { isDiagnosticActivity, isPendingRequest } from "./activityPolicy";
export const activitySections = {
  all: "All",
  unread: "Unread",
  mentions: "Mentions",
  system: "System",
};
export const activityTypes = {
  mention: "Mentions",
  conversation: "Replies / messages",
  invitation: "Invitations",
  approval: "Approvals",
  reminder: "Reminders",
  completion: "Completions",
  blocker: "Blockers",
  other: "Other updates",
};
export const activityStatuses = {
  unread: "Unread",
  read: "Read",
  action: "Needs action",
  completed: "Completed / resolved",
};
export type ActivitySection = keyof typeof activitySections;
export interface ActivityView {
  section: ActivitySection;
  query: string;
  types: (keyof typeof activityTypes)[];
  statuses: (keyof typeof activityStatuses)[];
  sort: "newest" | "oldest";
}
export const defaultActivityView: ActivityView = {
  section: "all",
  query: "",
  types: [],
  statuses: [],
  sort: "newest",
};
export function activityType(item: ActivityItem): keyof typeof activityTypes {
  if (item.kind === "mention") return "mention";
  if (item.kind === "reply" || item.kind === "message") return "conversation";
  if (
    item.kind === "invitation" ||
    item.kind === "approval" ||
    item.kind === "reminder" ||
    item.kind === "completion"
  )
    return item.kind;
  if (item.kind === "failure" || item.source === "interventions" || item.lifecycle === "request")
    return "blocker";
  return "other";
}
export function selectActivityView(items: ActivityItem[], view: ActivityView) {
  const words = view.query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const matching = items.filter((item) => {
    if (isDiagnosticActivity(item)) return false;
    const text = [item.title, item.body, item.sourceLabel || item.appId || "Misty"]
      .join(" ")
      .toLocaleLowerCase();
    const pending = isPendingRequest(item);
    const statuses = {
      unread: pending || (!item.readAt && !item.resolvedAt),
      read: !!item.readAt,
      action: pending,
      completed: !!item.resolvedAt || item.status === "completed" || item.kind === "completion",
    };
    return (
      words.every((word) => text.includes(word)) &&
      (!view.types.length || view.types.includes(activityType(item))) &&
      (!view.statuses.length || view.statuses.some((status) => statuses[status]))
    );
  });
  const belongs = (item: ActivityItem, section: ActivitySection) =>
    section === "all" ||
    (section === "unread"
      ? isPendingRequest(item) || (!item.readAt && !item.resolvedAt)
      : section === "mentions"
        ? item.kind === "mention"
        : !["mention", "reply", "message"].includes(item.kind));
  const counts = Object.fromEntries(
    Object.keys(activitySections).map((section) => [
      section,
      matching.filter((item) => belongs(item, section as ActivitySection)).length,
    ]),
  ) as Record<ActivitySection, number>;
  const visible = matching
    .filter((item) => belongs(item, view.section))
    .sort((a, b) => {
      const time = (item: ActivityItem) => Date.parse(item.updatedAt ?? item.createdAt) || 0;
      return (
        (view.sort === "newest" ? time(b) - time(a) : time(a) - time(b)) || a.id.localeCompare(b.id)
      );
    });
  return {
    counts,
    visible,
    narrowed:
      view.section !== "all" || !!words.length || !!view.types.length || !!view.statuses.length,
    readableIds: visible
      .filter((item) => !isPendingRequest(item) && !item.readAt)
      .map((item) => item.id),
    clearableIds: visible.filter((item) => !isPendingRequest(item)).map((item) => item.id),
  };
}
