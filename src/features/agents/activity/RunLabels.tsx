import { cn, Text, type TextTone } from "@/shared/ui";
import type { RunRow } from "./activityApi";

const stateLabel: Record<RunRow["state"], string> = {
  running: "Working",
  "needs-you": "Waiting for you",
  completed: "Done",
  failed: "Didn't finish",
  canceled: "Stopped",
};

/** The dot's tone, where the state means something; the rest take a dimmed muted dot. */
const dotTone: Partial<Record<RunRow["state"] | "idle", TextTone>> = {
  running: "working",
  "needs-you": "waiting",
  failed: "failed",
};

/**
 * A run's state as a word with a dot, colored only where the state means something. The word is
 * muted, or full color with `tone="default"` on a picture's badge.
 */
export function RunStateBadge({
  state,
  tone = "muted",
}: {
  state: RunRow["state"] | "idle";
  tone?: "muted" | "default";
}) {
  const label = state === "idle" ? "Idle" : stateLabel[state];
  const dot = dotTone[state];
  return (
    <Text
      bare
      size="caption"
      tone={tone}
      className="inline-flex shrink-0 items-center gap-1.5"
      data-state={state}
    >
      <Text
        bare
        tone={dot ?? "muted"}
        aria-hidden="true"
        className={cn("size-2 rounded-full bg-current", !dot && "opacity-70")}
      />
      {label}
    </Text>
  );
}

/** When a run started: the time today, else the day and time. */
export function runWhen(at: number, now: number): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (new Date(now).toDateString() === date.toDateString()) return time;
  return `${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
}
