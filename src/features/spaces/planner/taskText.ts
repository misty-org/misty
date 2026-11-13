import type { SpaceTask, SpaceTaskPriority, SpaceTaskStatus } from "./api";

export const statusLabel: Record<SpaceTaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
  canceled: "Canceled",
};

export const priorityLabel: Record<SpaceTaskPriority, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

/** "Dec 1": a due date as a card shows it. */
export function dueLabel(dueAt: string): string {
  return new Date(dueAt).toLocaleDateString([], { month: "short", day: "numeric" });
}

/** A task is overdue once its due day has passed and it is still open. */
export function isOverdue(task: Pick<SpaceTask, "due_at" | "status">, now = new Date()): boolean {
  if (!task.due_at || task.status === "done" || task.status === "canceled") return false;
  const due = new Date(task.due_at);
  due.setHours(23, 59, 59, 999);
  return due < now;
}

/** A stored instant as the `yyyy-mm-dd` a date field holds, in this computer's time. */
export function toDateField(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A date field's day as an instant: noon here, so the day is the same in nearby time zones. */
export function fromDateField(value: string): string {
  if (!value) return "";
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12).toISOString();
}
