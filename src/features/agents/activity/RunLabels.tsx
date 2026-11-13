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
