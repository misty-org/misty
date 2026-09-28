import type { ScheduledTask, ScheduledTaskSchedule } from "@/api/scheduled/api";

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "9:00 AM" from a stored "09:00", in the reader's own clock style. */
export function formatLocalTime(localTime: string): string {
  const [hours, minutes] = localTime.split(":").map(Number);
  const date = new Date(2000, 0, 1, hours, minutes);
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}

/** A one-line reading of a schedule, e.g. "Weekdays at 9:00 AM". */
export function describeSchedule(schedule: ScheduledTaskSchedule): string {
  const time = formatLocalTime(schedule.local_time);
  switch (schedule.cadence) {
    case "once": {
      const day = schedule.run_on
        ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
            new Date(`${schedule.run_on}T00:00:00`),
          )
        : "";
      return `Once on ${day} at ${time}`;
    }
    case "daily":
      return `Daily at ${time}`;
    case "weekdays":
      return `Weekdays at ${time}`;
    case "weekly":
      return `${weekdays[schedule.weekday] ?? "Weekly"}s at ${time}`;
    case "monthly":
      return `Monthly on day ${schedule.month_day} at ${time}`;
  }
}

/** When the task runs next, relative to today: "Today 9:00 AM", "Tomorrow …", "Mon, Oct 5 …". */
export function describeNextRun(task: ScheduledTask, now = new Date()): string {
  if (task.state === "running") return "Running now";
  if (!task.enabled) return "Paused";
  if (!task.next_run_at) return "Not scheduled";
  const next = new Date(task.next_run_at);
  const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(
    next,
  );
  const days = Math.round((startOfDay(next) - startOfDay(now)) / 86_400_000);
  if (days <= 0) return `Today ${time}`;
  if (days === 1) return `Tomorrow ${time}`;
  const day = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(next);
  return `${day} ${time}`;
}

export const weekdayNames = weekdays;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}
