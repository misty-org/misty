import type { DueFilter, TaskViewMode } from "@/models/types/features/spaces/SpacePlanner";
import type { SpaceTask } from "@/models/interfaces/features/spaces/types";

export const FILTER_PARAM_KEYS = ["status", "assignee", "priority", "due", "mine"] as const;

export function normalizeView(value?: string): TaskViewMode {
  return value === "list" || value === "calendar" ? value : "board";
}

export function activeFilterCount(params: URLSearchParams) {
  return FILTER_PARAM_KEYS.filter((key) => params.has(key)).length;
}

export function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/** A month either side of the visible one, so scrolling does not refetch. */
export function calendarRange(month: Date) {
  return {
    from: new Date(month.getFullYear(), month.getMonth() - 1, 1),
    to: new Date(month.getFullYear(), month.getMonth() + 2, 1),
  };
}

/** The server-side slice of a due filter; undefined means "do not narrow". */
export function filterDueRange(filter: DueFilter): { from?: string; to?: string } | undefined {
  const now = new Date();
  if (filter === "overdue") return { to: now.toISOString() };
  if (filter === "today") {
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const to = new Date(from);
    to.setDate(to.getDate() + 1);
    return { from: from.toISOString(), to: to.toISOString() };
  }
  if (filter === "week") {
    const to = new Date(now);
    to.setDate(to.getDate() + 7);
    return { from: now.toISOString(), to: to.toISOString() };
  }
  return undefined;
}

/**
 * The client-side half of the due filter.
 *
 * "No due date" and "overdue" both depend on state the range query cannot
 * express — absence of a date, and whether the task is still open.
 */
export function matchesDueFilter(task: SpaceTask, filter: DueFilter) {
  if (filter === "no_due") return !task.due_at;
  if (filter === "overdue")
    return Boolean(
      task.due_at &&
      new Date(task.due_at) < new Date() &&
      task.status !== "done" &&
      task.status !== "canceled",
    );
  return true;
}

export function isTypingTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}
