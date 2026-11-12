import type { RunRow } from "./activityApi";

const stateLabel: Record<RunRow["state"], string> = {
  running: "Working",
  "needs-you": "Waiting for you",
  completed: "Done",
  failed: "Didn't finish",
  canceled: "Stopped",
};

/** A run's state as a word with a dot, colored only where the state means something. */
export function RunStateBadge({ state }: { state: RunRow["state"] | "idle" }) {
  const label = state === "idle" ? "Idle" : stateLabel[state];
  return (
    <span className="activity-state" data-state={state}>
      <span className="activity-state-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

/** When a run started: the time today, else the day and time. */
export function runWhen(at: number, now = Date.now()): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (new Date(now).toDateString() === date.toDateString()) return time;
  return `${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
}

/** The time of day alone, for a row under a day's heading. */
export function runTime(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** A day's heading: Today, Yesterday, or the date. */
export function dayLabel(at: number, now = Date.now()): string {
  const day = new Date(at);
  const today = new Date(now);
  if (day.toDateString() === today.toDateString()) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(today.getDate() - 1);
  if (day.toDateString() === yesterday.toDateString()) return "Yesterday";
  return day.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    ...(day.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** A day's key, for grouping runs by the day they started. */
export const dayKey = (at: number) => new Date(at).toDateString();
